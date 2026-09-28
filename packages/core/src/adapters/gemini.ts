import type { AdapterOptions, AdapterResult, Citation, PlatformAdapter } from "./types";
import { adapterResultSchema } from "./types";

/**
 * Живой адаптер Gemini: Interactions API с инструментом Google Search.
 *
 * НЕ ПОДКЛЮЧЁН И НЕ ВЫЗЫВАЕТСЯ. Gemini не измеряется и на сайте не
 * упоминается вовсе: условия Google на grounded-поиск запрещают
 * анализировать результаты и строить из них индекс, а хранить разрешают до
 * двух лет и только ради улучшения отображения — продукт делает ровно
 * запрещённое. Регистрации в `live.ts` нет даже при заданном ключе,
 * каталог ассистентов его не содержит. Разбор условий и условие
 * пересмотра — docs/open-questions/gemini-grounding.md.
 *
 * Файл оставлен намеренно: код верен, покрыт тестами и понадобится сразу,
 * если условия изменятся. Переписывать его заново дороже, чем держать.
 *
 * Как и у OpenAI, поиск обязателен: без него модель отвечает по памяти, а
 * измеряем мы ответ со ссылками. Форма ответа своя — шаги вместо блоков
 * вывода, — но цитаты по счастью устроены так же: аннотации `url_citation`.
 */

export const DEFAULT_GEMINI_ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/interactions";

/** Модель по умолчанию — flash: измерению нужен типичный ответ, а не максимум качества. */
export const DEFAULT_GEMINI_MODEL = "gemini-3.6-flash";

export interface GeminiPricing {
  inputPerMillion: number;
  /** Выходные токены включают «мысли» — Google тарифицирует их так же. */
  outputPerMillion: number;
  searchPerThousandRequests: number;
}

export const GEMINI_PRICING: Record<string, GeminiPricing> = {
  "gemini-3.6-flash": {
    inputPerMillion: 1.5,
    outputPerMillion: 7.5,
    searchPerThousandRequests: 14,
  },
};

export interface GeminiUsage {
  input_tokens?: number;
  output_tokens?: number;
  /** Токены, потраченные инструментом на подтянутый контент. */
  tool_use_input_tokens?: number;
  total_tokens?: number;
}

/**
 * Стоимость ответа.
 *
 * Бесплатные 5 000 поисков в месяц сознательно НЕ учитываются: они общие на
 * весь аккаунт, а мы считаем стоимость одного ответа и не знаем, сколько от
 * лимита уже съедено. Занизить расход опаснее, чем завысить, — на этих цифрах
 * агентство решает, сколько брать с клиента.
 */
export function geminiCostUsd(
  usage: GeminiUsage,
  searchRequests: number,
  pricing: GeminiPricing,
): number {
  const input = (usage.input_tokens ?? 0) + (usage.tool_use_input_tokens ?? 0);
  const output = usage.output_tokens ?? 0;

  const total =
    (input / 1_000_000) * pricing.inputPerMillion +
    (output / 1_000_000) * pricing.outputPerMillion +
    (searchRequests / 1000) * pricing.searchPerThousandRequests;

  return Math.round(total * 1_000_000) / 1_000_000;
}

interface GeminiStep {
  type: string;
  arguments?: { queries?: string[] };
  content?: { type: string; text?: string; annotations?: unknown[] }[];
}

interface GeminiPayload {
  model?: string;
  steps?: GeminiStep[];
  usage?: GeminiUsage;
}

export function extractGeminiText(payload: GeminiPayload): string {
  return (payload.steps ?? [])
    .filter((step) => step.type === "model_output")
    .flatMap((step) => step.content ?? [])
    .filter((part) => part.type === "text")
    .map((part) => part.text ?? "")
    .join("\n")
    .trim();
}

/** Цитаты — из аннотаций `url_citation`; дубли схлопываются по URL. */
export function extractGeminiCitations(payload: GeminiPayload): Citation[] {
  const seen = new Map<string, Citation>();

  for (const step of payload.steps ?? []) {
    if (step.type !== "model_output") continue;

    for (const part of step.content ?? []) {
      for (const raw of part.annotations ?? []) {
        const annotation = raw as { type?: string; url?: string; title?: string };
        if (annotation.type !== "url_citation" || !annotation.url) continue;
        if (seen.has(annotation.url)) continue;

        seen.set(annotation.url, {
          url: annotation.url,
          ...(annotation.title ? { title: annotation.title } : {}),
        });
      }
    }
  }

  return [...seen.values()];
}

/**
 * Сколько раз модель ходила в поиск. Отдельного счётчика в ответе нет,
 * поэтому считаем шаги вызова — по ним и выставляется счёт.
 */
export function countGeminiSearches(payload: GeminiPayload): number {
  return (payload.steps ?? []).filter((step) => step.type === "google_search_call").length;
}

export interface GeminiAdapterConfig {
  apiKey: string;
  model?: string;
  endpoint?: string;
  pricing?: GeminiPricing;
  /** Подменяется в тестах: сеть в них не используется никогда. */
  fetchImpl?: typeof fetch;
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

const RETRYABLE_STATUSES = new Set([408, 409, 429, 500, 502, 503, 504]);

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class GeminiAdapter implements PlatformAdapter {
  readonly platform = "gemini" as const;

  private readonly model: string;
  private readonly endpoint: string;
  private readonly pricing: GeminiPricing;
  private readonly fetchImpl: typeof fetch;
  private readonly maxAttempts: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutMs: number;

  constructor(private readonly config: GeminiAdapterConfig) {
    if (!config.apiKey) {
      throw new Error("GEMINI_API_KEY is not set. Use ADAPTERS_MODE=mock or provide the key.");
    }

    this.model = config.model ?? DEFAULT_GEMINI_MODEL;
    const pricing = config.pricing ?? GEMINI_PRICING[this.model];
    if (!pricing) {
      throw new Error(
        `No pricing for Gemini model "${this.model}". Add it to GEMINI_PRICING, otherwise cost per answer cannot be recorded.`,
      );
    }

    this.pricing = pricing;
    this.endpoint = config.endpoint ?? DEFAULT_GEMINI_ENDPOINT;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.maxAttempts = config.maxAttempts ?? 3;
    this.sleep = config.sleep ?? defaultSleep;
    this.timeoutMs = config.timeoutMs ?? 120_000;
  }

  async execute(prompt: string, opts?: AdapterOptions): Promise<AdapterResult> {
    const startedAt = Date.now();
    const payload = await this.request(prompt, opts);

    const text = extractGeminiText(payload);
    if (text === "") {
      throw new Error("Gemini returned no answer text");
    }

    return adapterResultSchema.parse({
      text,
      citations: extractGeminiCitations(payload),
      modelVersion: payload.model ?? this.model,
      costUsd: geminiCostUsd(payload.usage ?? {}, countGeminiSearches(payload), this.pricing),
      latencyMs: Date.now() - startedAt,
    });
  }

  private async request(prompt: string, opts?: AdapterOptions): Promise<GeminiPayload> {
    const instructions = [
      opts?.lang ? `Answer in ${opts.lang}.` : "",
      opts?.geo ? `Assume the user is in ${opts.geo}.` : "",
    ]
      .filter(Boolean)
      .join(" ");

    const body = JSON.stringify({
      model: this.model,
      input: instructions ? `${instructions}\n\n${prompt}` : prompt,
      tools: [{ type: "google_search" }],
    });

    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        const response = await this.fetchImpl(this.endpoint, {
          method: "POST",
          headers: {
            // Ключ идёт заголовком, а не в query: в query он утечёт в логи прокси.
            "x-goog-api-key": this.config.apiKey,
            "Content-Type": "application/json",
          },
          body,
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        if (response.ok) {
          return (await response.json()) as GeminiPayload;
        }

        const detail = (await response.text()).slice(0, 500);
        const error = new Error(`Gemini responded ${response.status}: ${detail}`);

        if (!RETRYABLE_STATUSES.has(response.status)) {
          throw error;
        }
        lastError = error;
      } catch (error) {
        if (error instanceof Error && /^Gemini responded [45]\d\d/.test(error.message)) {
          const status = Number(error.message.slice(17, 20));
          if (!RETRYABLE_STATUSES.has(status)) {
            throw error;
          }
        }
        lastError = error instanceof Error ? error : new Error(String(error));
      }

      if (attempt < this.maxAttempts) {
        await this.sleep(2 ** (attempt - 1) * 1000);
      }
    }

    throw lastError ?? new Error("Gemini request failed");
  }
}
