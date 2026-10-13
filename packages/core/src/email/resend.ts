import { EMAIL_COPY } from "./templates";
import type { EmailMessage, EmailSender, SentEmail } from "./types";

/**
 * Живой транспорт писем (Resend).
 *
 * Обращение к API идёт через `fetch`, а не через SDK: сборка герметична, а
 * весь внешний обмен продукта и так живёт за интерфейсами этого пакета.
 * Сеть трогается только здесь; в тестах транспорт получает свой `fetch`.
 */

const ENDPOINT = "https://api.resend.com/emails";

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

export interface ResendEmailSenderConfig {
  apiKey: string;
  /** Адрес отправителя: домен должен быть подтверждён в Resend. */
  from?: string;
  endpoint?: string;
  fetchImpl?: typeof fetch;
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
  /** Первая пауза перед повтором; дальше удваивается. */
  retryDelayMs?: number;
  /** Потолок паузы: за отправкой стоит живой запрос интерфейса. */
  maxDelayMs?: number;
  /** Куда записать письмо, которое так и не ушло. */
  onFailure?: (message: EmailMessage, error: Error) => void;
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class ResendEmailSender implements EmailSender {
  private readonly from: string;
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly maxAttempts: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutMs: number;
  private readonly retryDelayMs: number;
  private readonly maxDelayMs: number;
  private readonly onFailure: ((message: EmailMessage, error: Error) => void) | null;

  constructor(private readonly config: ResendEmailSenderConfig) {
    if (!config.apiKey) {
      throw new Error("RESEND_API_KEY is not set. Use EMAIL_MODE=log or provide the key.");
    }

    this.from = composeFrom(config.from ?? EMAIL_COPY.defaultFrom);
    this.endpoint = config.endpoint ?? ENDPOINT;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.maxAttempts = Math.max(1, config.maxAttempts ?? 3);
    this.sleep = config.sleep ?? defaultSleep;
    this.timeoutMs = config.timeoutMs ?? 15_000;
    this.retryDelayMs = config.retryDelayMs ?? 500;
    this.maxDelayMs = config.maxDelayMs ?? 8_000;
    this.onFailure = config.onFailure ?? null;
  }

  async send(message: EmailMessage): Promise<SentEmail> {
    try {
      return await this.deliver(message);
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      // Письмо не исчезает вместе с отказом: сначала в лог, потом ошибка наверх.
      this.onFailure?.(message, failure);
      throw failure;
    }
  }

  private async deliver(message: EmailMessage): Promise<SentEmail> {
    // Письмо без текстовой версии читается не везде и чаще уходит в спам.
    if (!message.text.trim()) {
      throw new Error("Email has no plain-text body; HTML alone is not enough.");
    }

    const payload = {
      from: message.fromName ? withDisplayName(this.from, message.fromName) : this.from,
      to: [message.to],
      subject: message.subject,
      text: message.text,
      ...(message.html ? { html: message.html } : {}),
      ...(message.replyTo ? { reply_to: [sanitiseHeader(message.replyTo)] } : {}),
    };

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      let response: Response;
      try {
        response = await this.fetchImpl(this.endpoint, {
          method: "POST",
          headers: {
            authorization: `Bearer ${this.config.apiKey}`,
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(this.timeoutMs),
        });
      } catch (error) {
        // Сеть отвалилась — это повторяемо.
        lastError = error instanceof Error ? error : new Error(String(error));
        await this.backoff(attempt, null);
        continue;
      }

      if (response.ok) {
        const body = (await response.json()) as { id?: string };
        if (!body.id) {
          throw new Error("Resend accepted the request but returned no message id.");
        }
        return { id: body.id };
      }

      const body = await response.text();
      const error = new Error(`Resend responded ${response.status}: ${body.slice(0, 500)}`);
      // Отказ по существу (неверный ключ, неподтверждённый домен) повторять
      // бессмысленно: повтор превратит понятную ошибку в долгое молчание.
      if (!RETRYABLE_STATUSES.has(response.status)) {
        throw error;
      }

      lastError = error;
      await this.backoff(attempt, parseRetryAfter(response.headers.get("retry-after")));
    }

    throw new Error(
      `Email delivery failed after ${this.maxAttempts} attempts: ${lastError?.message ?? "unknown error"}`,
      lastError ? { cause: lastError } : undefined,
    );
  }

  /**
   * Пауза перед повтором.
   *
   * Если сервер сам сказал, сколько ждать (`Retry-After` на 429), слушаемся
   * его, а не своей формулы: повтор раньше разрешённого ничего не меняет.
   * Сверху — потолок, иначе интерфейс будет ждать минутами.
   */
  private async backoff(attempt: number, retryAfterMs: number | null): Promise<void> {
    if (attempt >= this.maxAttempts) return;
    const planned = retryAfterMs ?? 2 ** (attempt - 1) * this.retryDelayMs;
    await this.sleep(Math.min(planned, this.maxDelayMs));
  }
}

/**
 * Разбирает `Retry-After`: и секунды, и дату по HTTP-спецификации.
 * Непонятное значение — не повод ждать наугад, ответ `null`.
 */
export function parseRetryAfter(raw: string | null, now: () => number = Date.now): number | null {
  if (!raw) return null;

  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed) * 1000;

  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return null;
  return Math.max(0, at - now());
}

/**
 * Приводит адрес отправителя к виду с именем.
 *
 * `EMAIL_FROM=noreply@agency.com` — законная настройка, но почтовый клиент
 * покажет получателю голый адрес. Имя продукта подставляется само; письма
 * клиентам агентства всё равно перебьют его своим (инвариант 3).
 */
export function composeFrom(from: string): string {
  const raw = from.trim();
  if (raw.includes("<")) return raw;
  return withDisplayName(raw, EMAIL_COPY.productName);
}

/**
 * Подставляет имя отправителя к адресу: «Имя <адрес>».
 *
 * Имя приходит из данных агентства, поэтому из него убирается всё, что
 * может сломать заголовок: кавычки, угловые скобки и переводы строк.
 */
export function withDisplayName(from: string, name: string): string {
  // indexOf, а не /<([^>]+)>/: регулярка квадратична на строке из многих «<».
  const open = from.indexOf("<");
  const close = open >= 0 ? from.indexOf(">", open + 1) : -1;
  const address = close > open + 1 ? from.slice(open + 1, close) : from.trim();
  const safe = name.replace(/["<>\r\n\\]/g, "").trim();
  return safe ? `"${safe}" <${address}>` : from;
}

/** Ни один заголовок не должен уметь дописать к письму лишнюю строку. */
function sanitiseHeader(value: string): string {
  return value.replace(/[\r\n]/g, "").trim();
}
