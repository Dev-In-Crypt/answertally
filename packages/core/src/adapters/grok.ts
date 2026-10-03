import type { AdapterOptions, AdapterResult, PlatformAdapter } from "./types";
import { adapterResultSchema } from "./types";
import { defaultSleep, MAX_ANSWER_OUTPUT_TOKENS, MAX_SEARCHES_PER_ANSWER, postJson } from "./http";
import { extractCitations, extractText } from "./openai";

/**
 * Живой адаптер Grok: Responses API xAI с инструментом веб-поиска.
 *
 * Формат ответа у xAI совместим с Responses API OpenAI — блоки `message` с
 * аннотациями `url_citation`, — поэтому текст и цитаты читаются теми же
 * функциями, что и у ChatGPT. Расходятся только адрес, ключ и прайс.
 *
 * ВАЖНО: форма ответа взята из документации, а не с живого вызова — ключа на
 * момент написания не было. Модель и прайс сверены по docs.x.ai/developers/pricing
 * (2026-09-22); точная строка id модели — нет: xAI не публикует список id
 * машиночитаемо, а `live-check` возвращает точную ошибку, если она неверна.
 */

export const DEFAULT_GROK_ENDPOINT = "https://api.x.ai/v1/responses";

/**
 * Модель по умолчанию — самая дешёвая в линейке без ярлыка «reasoning»: нам
 * нужен не ход мысли, а факт, и рассуждения только раздувают расход. Ещё
 * дешевле есть `grok-build-0.1`, но назначение этой модели в документации не
 * раскрыто, и она не взята как умолчание по той же причине, по которой в
 * этом продукте не берётся неназванная модель нигде больше.
 */
export const DEFAULT_GROK_MODEL = "grok-4.20-0309-non-reasoning";

export interface GrokPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  webSearchPerThousandCalls: number;
}

/**
 * Прайс на 1M токенов и на 1000 вызовов поиска. Модель без строки здесь
 * адаптер отвергает: стоимость каждого ответа обязана записываться.
 *
 * Сверено по docs.x.ai/developers/pricing, 2026-09-22 (тарифы до 200k токенов
 * контекста — измерению больше не требуется). Стоимость поиска НЕ сверена с
 * живым счётом — см. заметку в шапке файла.
 */
export const GROK_PRICING: Record<string, GrokPricing> = {
  "grok-4.20-0309-non-reasoning": {
    inputPerMillion: 1.25,
    outputPerMillion: 2.5,
    webSearchPerThousandCalls: 5,
  },
};

export interface GrokUsage {
  input_tokens?: number;
  output_tokens?: number;
}

/**
 * Стоимость ответа по нашему прайсу.
 *
 * Провайдер может присылать и собственную цифру, но её единицы в документации
 * не закреплены, а ошибка в порядок величины тихо превратилась бы в убыток
 * или в фантомную прибыль. Поэтому считаем сами, а сверка со счётом —
 * ручная.
 */
export function grokCostUsd(usage: GrokUsage, searchCalls: number, pricing: GrokPricing): number {
  const total =
    ((usage.input_tokens ?? 0) / 1_000_000) * pricing.inputPerMillion +
    ((usage.output_tokens ?? 0) / 1_000_000) * pricing.outputPerMillion +
    (searchCalls / 1000) * pricing.webSearchPerThousandCalls;

  return Math.round(total * 1_000_000) / 1_000_000;
}

interface GrokPayload {
  model?: string;
  output?: {
    type: string;
    content?: { type: string; text?: string; annotations?: unknown[] }[];
  }[];
  usage?: GrokUsage;
}

/** Вызовы поиска считаются по элементам вывода: по ним выставляется счёт. */
export function countGrokSearches(payload: GrokPayload): number {
  return (payload.output ?? []).filter((item) => /search_call$/.test(item.type)).length;
}

export interface GrokAdapterConfig {
  apiKey: string;
  model?: string;
  endpoint?: string;
  pricing?: GrokPricing;
  /** Подменяется в тестах: сеть в них не используется никогда. */
  fetchImpl?: typeof fetch;
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

export class GrokAdapter implements PlatformAdapter {
  readonly platform = "grok" as const;

  private readonly model: string;
  private readonly endpoint: string;
  private readonly pricing: GrokPricing;
  private readonly fetchImpl: typeof fetch;
  private readonly maxAttempts: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutMs: number;

  constructor(private readonly config: GrokAdapterConfig) {
    if (!config.apiKey) {
      throw new Error("XAI_API_KEY is not set. Use ADAPTERS_MODE=mock or provide the key.");
    }

    this.model = config.model ?? DEFAULT_GROK_MODEL;
    const pricing = config.pricing ?? GROK_PRICING[this.model];
    if (!pricing) {
      throw new Error(
        `No pricing for Grok model "${this.model}". Add it to GROK_PRICING, otherwise cost per answer cannot be recorded.`,
      );
    }

    this.pricing = pricing;
    this.endpoint = config.endpoint ?? DEFAULT_GROK_ENDPOINT;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.maxAttempts = config.maxAttempts ?? 3;
    this.sleep = config.sleep ?? defaultSleep;
    this.timeoutMs = config.timeoutMs ?? 120_000;
  }

  async execute(prompt: string, opts?: AdapterOptions): Promise<AdapterResult> {
    const startedAt = Date.now();
    const payload = await this.request(prompt, opts);

    // Читателям нужен только вывод: расход у xAI устроен по-своему, и
    // подсовывать его под форму OpenAI незачем.
    const answer = { output: payload.output };
    const text = extractText(answer);
    if (text === "") {
      throw new Error("Grok returned no answer text");
    }

    return adapterResultSchema.parse({
      text,
      citations: extractCitations(answer),
      modelVersion: payload.model ?? this.model,
      costUsd: grokCostUsd(payload.usage ?? {}, countGrokSearches(payload), this.pricing),
      latencyMs: Date.now() - startedAt,
    });
  }

  private request(prompt: string, opts?: AdapterOptions): Promise<GrokPayload> {
    const instructions = [
      opts?.lang ? `Answer in ${opts.lang}.` : "",
      opts?.geo ? `Assume the user is in ${opts.geo}.` : "",
    ]
      .filter(Boolean)
      .join(" ");

    const body = JSON.stringify({
      model: this.model,
      input: prompt,
      tools: [{ type: "web_search" }],
      max_output_tokens: MAX_ANSWER_OUTPUT_TOKENS,
      // У xAI потолок — на ходы агента, а не на отдельные поиски: за ход
      // модель может искать параллельно. Ближайший доступный рычаг.
      max_turns: MAX_SEARCHES_PER_ANSWER,
      ...(instructions ? { instructions } : {}),
    });

    return postJson<GrokPayload>({
      provider: "Grok",
      url: this.endpoint,
      headers: { Authorization: `Bearer ${this.config.apiKey}` },
      body,
      fetchImpl: this.fetchImpl,
      maxAttempts: this.maxAttempts,
      sleep: this.sleep,
      timeoutMs: this.timeoutMs,
    });
  }
}
