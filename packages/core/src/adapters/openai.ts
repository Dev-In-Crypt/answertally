import type { AdapterOptions, AdapterResult, Citation, PlatformAdapter } from "./types";
import { adapterResultSchema } from "./types";
import { MAX_OPENAI_OUTPUT_TOKENS, MAX_SEARCHES_PER_ANSWER } from "./http";

/**
 * Живой адаптер ChatGPT: Responses API с включённым инструментом веб-поиска.
 *
 * Поиск обязателен, а не желателен: без него модель отвечает по памяти, а
 * продукт измеряет именно то, что видит покупатель — ответ со ссылками на
 * источники. Ответ без цитат для нас не «дешевле», а бессмысленен.
 *
 * Сеть трогается только здесь; в тестах адаптер получает свой `fetch`.
 */

const ENDPOINT = "https://api.openai.com/v1/responses";

/**
 * Модель по умолчанию — самая дешёвая из линейки: нам нужен не стиль, а факт.
 *
 * `gpt-6.1-luna` не существует: в линейке 6.1 вышел только Sol, а Astra
 * отменили. Самая новая Luna — эта, и она вдвое дешевле прежней
 * `gpt-5.6-luna` на входе и в 2,4 раза на выходе.
 *
 * Смена модели меняет и сами измерения. Она сделана в момент, когда в базе
 * нет ни одного ответа, — сравнивать не с чем, и разрыва в ряду не возникает.
 * Дальше версия модели пишется к каждому ответу, поэтому следующая такая
 * смена будет видна, а не спрятана (инвариант 6).
 */
export const DEFAULT_OPENAI_MODEL = "gpt-6-luna";

export type ReasoningEffort = "none" | "low" | "medium" | "high" | "xhigh" | "max";

/**
 * Уровень рассуждений задаётся явно, а не оставляется на умолчание провайдера.
 *
 * Причина не в деньгах, а в сравнимости: умолчание однажды сдвинется, ответы
 * станут устроены иначе, и мы увидим «изменение видимости» у клиента, у
 * которого ничего не менялось (инвариант 6).
 *
 * Замер 2026-08-12 на одном промпте, по одному вызову на уровень:
 *   none   — 1 поиск, 2 цитаты, $0.0133
 *   low    — 1 поиск, 1 цитата, $0.0132
 *   medium — 2 поиска, 5 цитат, $0.0242
 *   high   — 3 поиска, 7 цитат, $0.0377
 * Уровень управляет числом обращений к поиску, а значит и стоимостью, и тем,
 * сколько источников вообще попадёт в диагностику. На `low` источников почти
 * нет — граф источников, ради которого продукт и существует, остаётся пустым.
 * Поэтому `medium`: вдвое дешевле `high` и не лишает диагностику данных.
 */
export const DEFAULT_REASONING_EFFORT: ReasoningEffort = "medium";

/**
 * Прайс на 1M токенов и на 1000 вызовов поиска.
 *
 * Лежит в коде, потому что стоимость каждого ответа пишется в БД и должна
 * считаться одинаково везде. Значения переопределяются из env: провайдер
 * меняет цены, а перевыкладывать релиз ради этого — плохая причина.
 */
export interface OpenAiPricing {
  inputPerMillion: number;
  cachedInputPerMillion: number;
  outputPerMillion: number;
  webSearchPerThousandCalls: number;
}

export const OPENAI_PRICING: Record<string, OpenAiPricing> = {
  // Сверено по developers.openai.com/api/docs/pricing, 2026-09-29.
  "gpt-6-luna": {
    inputPerMillion: 0.1,
    cachedInputPerMillion: 0.01,
    outputPerMillion: 0.5,
    webSearchPerThousandCalls: 10,
  },
  "gpt-5.6-luna": {
    inputPerMillion: 0.2,
    cachedInputPerMillion: 0.02,
    outputPerMillion: 1.2,
    webSearchPerThousandCalls: 10,
  },
  "gpt-5.6-terra": {
    inputPerMillion: 2,
    cachedInputPerMillion: 0.2,
    outputPerMillion: 12,
    webSearchPerThousandCalls: 10,
  },
  "gpt-5.6-sol": {
    inputPerMillion: 5,
    cachedInputPerMillion: 0.5,
    outputPerMillion: 30,
    webSearchPerThousandCalls: 10,
  },
};

export interface OpenAiUsage {
  input_tokens: number;
  output_tokens: number;
  input_tokens_details?: { cached_tokens?: number };
}

/**
 * Стоимость ответа. Кэшированные токены считаются по своей цене — иначе
 * расход завышается там, где провайдер уже дал скидку.
 *
 * Вызовы поиска обычно дороже всех токенов вместе взятых, поэтому они
 * считаются отдельным слагаемым, а не прячутся в округление.
 */
export function openAiCostUsd(
  usage: OpenAiUsage,
  webSearchCalls: number,
  pricing: OpenAiPricing,
): number {
  const cached = usage.input_tokens_details?.cached_tokens ?? 0;
  const uncached = Math.max(0, usage.input_tokens - cached);

  const tokens =
    (uncached / 1_000_000) * pricing.inputPerMillion +
    (cached / 1_000_000) * pricing.cachedInputPerMillion +
    (usage.output_tokens / 1_000_000) * pricing.outputPerMillion;

  const search = (webSearchCalls / 1000) * pricing.webSearchPerThousandCalls;

  // Шесть знаков — точность колонки cost_usd в БД.
  return Math.round((tokens + search) * 1_000_000) / 1_000_000;
}

interface ResponsePayload {
  model?: string;
  output?: {
    type: string;
    content?: { type: string; text?: string; annotations?: unknown[] }[];
  }[];
  usage?: OpenAiUsage;
  tool_usage?: { web_search?: { num_requests?: number } };
}

/** Текст ответа собирается из блоков message: остальные типы — служебные. */
export function extractText(payload: ResponsePayload): string {
  return (payload.output ?? [])
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === "output_text")
    .map((part) => part.text ?? "")
    .join("\n")
    .trim();
}

/**
 * Цитаты — из аннотаций типа url_citation. Дубли схлопываются по URL:
 * модель ссылается на один источник по нескольку раз, а нам нужен факт
 * цитирования, а не его количество.
 */
export function extractCitations(payload: ResponsePayload): Citation[] {
  const seen = new Map<string, Citation>();

  for (const item of payload.output ?? []) {
    if (item.type !== "message") continue;

    for (const part of item.content ?? []) {
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

export interface OpenAiAdapterConfig {
  apiKey: string;
  model?: string;
  reasoningEffort?: ReasoningEffort;
  pricing?: OpenAiPricing;
  /** Подменяется в тестах: сеть в них не используется никогда. */
  fetchImpl?: typeof fetch;
  maxAttempts?: number;
  /** Пауза перед повтором; в тестах передаётся no-op. */
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

const RETRYABLE_STATUSES = new Set([408, 409, 429, 500, 502, 503, 504]);

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class OpenAiAdapter implements PlatformAdapter {
  readonly platform = "chatgpt" as const;

  private readonly model: string;
  private readonly reasoningEffort: ReasoningEffort;
  private readonly pricing: OpenAiPricing;
  private readonly fetchImpl: typeof fetch;
  private readonly maxAttempts: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutMs: number;

  constructor(private readonly config: OpenAiAdapterConfig) {
    if (!config.apiKey) {
      throw new Error("OPENAI_API_KEY is not set. Use ADAPTERS_MODE=mock or provide the key.");
    }

    this.model = config.model ?? DEFAULT_OPENAI_MODEL;
    this.reasoningEffort = config.reasoningEffort ?? DEFAULT_REASONING_EFFORT;
    const pricing = config.pricing ?? OPENAI_PRICING[this.model];
    if (!pricing) {
      throw new Error(
        `No pricing for OpenAI model "${this.model}". Add it to OPENAI_PRICING, otherwise cost per answer cannot be recorded.`,
      );
    }

    this.pricing = pricing;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.maxAttempts = config.maxAttempts ?? 3;
    this.sleep = config.sleep ?? defaultSleep;
    this.timeoutMs = config.timeoutMs ?? 120_000;
  }

  async execute(prompt: string, opts?: AdapterOptions): Promise<AdapterResult> {
    const startedAt = Date.now();
    const payload = await this.request(prompt, opts);

    const text = extractText(payload);
    if (text === "") {
      throw new Error("OpenAI returned no answer text");
    }

    const usage = payload.usage ?? { input_tokens: 0, output_tokens: 0 };
    const searchCalls = payload.tool_usage?.web_search?.num_requests ?? 0;

    return adapterResultSchema.parse({
      text,
      citations: extractCitations(payload),
      // Версия берётся из ответа, а не из конфига: провайдер вправе увести
      // алиас на другую сборку, и сравнивать измерения между собой можно
      // только зная, чем они получены (инвариант 6). Уровень рассуждений
      // входит в стемп по той же причине: он меняет и число источников,
      // и состав ответа, то есть ровно то, что мы измеряем.
      modelVersion: `${payload.model ?? this.model} (reasoning: ${this.reasoningEffort})`,
      costUsd: openAiCostUsd(usage, searchCalls, this.pricing),
      latencyMs: Date.now() - startedAt,
    });
  }

  private async request(prompt: string, opts?: AdapterOptions): Promise<ResponsePayload> {
    const body = JSON.stringify({
      model: this.model,
      tools: [{ type: "web_search" }],
      input: prompt,
      reasoning: { effort: this.reasoningEffort },
      max_output_tokens: MAX_OPENAI_OUTPUT_TOKENS,
      max_tool_calls: MAX_SEARCHES_PER_ANSWER,
      ...(opts?.lang || opts?.geo
        ? {
            instructions: [
              opts.lang ? `Answer in ${opts.lang}.` : "",
              opts.geo ? `Assume the user is in ${opts.geo}.` : "",
            ]
              .filter(Boolean)
              .join(" "),
          }
        : {}),
    });

    let lastError: Error | undefined;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      try {
        const response = await this.fetchImpl(ENDPOINT, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.config.apiKey}`,
            "Content-Type": "application/json",
          },
          body,
          signal: AbortSignal.timeout(this.timeoutMs),
        });

        if (response.ok) {
          return (await response.json()) as ResponsePayload;
        }

        const detail = (await response.text()).slice(0, 500);
        lastError = new Error(`OpenAI responded ${response.status}: ${detail}`);

        // 4xx кроме перечисленных — наша ошибка: повтор даст тот же ответ.
        if (!RETRYABLE_STATUSES.has(response.status)) {
          throw lastError;
        }
      } catch (error) {
        if (error instanceof Error && error.message.startsWith("OpenAI responded")) {
          if (!RETRYABLE_STATUSES.has(Number(error.message.slice(17, 20)))) {
            throw error;
          }
        }
        lastError = error instanceof Error ? error : new Error(String(error));
      }

      if (attempt < this.maxAttempts) {
        // Экспоненциальная пауза: 1s, 2s. Провайдер просит подождать, а не долбить.
        await this.sleep(2 ** (attempt - 1) * 1000);
      }
    }

    throw lastError ?? new Error("OpenAI request failed");
  }
}
