import type { AdapterOptions, AdapterResult, Citation, PlatformAdapter } from "./types";
import { adapterResultSchema } from "./types";
import { defaultSleep, postJson } from "./http";

/**
 * Живой адаптер Perplexity: Agent API (`POST /v1/agent`) с пресетом.
 *
 * Раньше адаптер ходил в Sonar Chat Completions, но провайдер поддерживает его
 * только до 2026-09-27 и называет Agent API прямой заменой: обычному `sonar`
 * соответствует пресет `fast`.
 *
 * Что это значит для измерения. Пресеты Agent API отвечают моделями OpenAI:
 * `fast` работает на `openai/gpt-5.6-luna`. От Perplexity здесь поиск и выбор
 * источников, а текст пишет чужая модель. Поэтому настоящая модель берётся из
 * ответа и вместе с пресетом пишется в `model_version`: колонка «Perplexity»
 * не должна выдавать себя за собственную модель провайдера (инвариант 6).
 *
 * Форма ответа снята с живого вызова 2026-09-22, а не взята из документации:
 * у `fast` в тексте нет аннотаций `url_citation`, о которых пишет справочник.
 * Источники приходят отдельным элементом `search_results`, а текст ссылается
 * на них номерами вида `[3]`, совпадающими с `id` результата.
 */

export const DEFAULT_PERPLEXITY_ENDPOINT = "https://api.perplexity.ai/v1/agent";

/**
 * Пресет по умолчанию — `fast`, преемник обычного `sonar`: один поиск, один
 * шаг. Более тяжёлые пресеты ходят по страницам и делают много шагов — ответ
 * становится исследованием, а не тем, что увидит спросивший покупатель.
 */
export const DEFAULT_PERPLEXITY_PRESET = "fast";

export interface PerplexityPricing {
  inputPerMillion: number;
  outputPerMillion: number;
  /** Плата за один вызов веб-поиска. */
  webSearchPerCall: number;
}

/**
 * Запасной прайс — только на случай, если провайдер не пришлёт свою цифру.
 *
 * Провайдер считает стоимость сам (`usage.cost.total_cost`), и она точнее
 * любого нашего расчёта. Здесь взяты верхние значения диапазона цен luna из
 * страницы цен ($0.40 / $1.80 за 1M токенов) и $0.0025 за поиск: занизить
 * расход опаснее, чем завысить, — на этих цифрах агентство назначает цену.
 */
export const PERPLEXITY_PRICING: Record<string, PerplexityPricing> = {
  fast: {
    inputPerMillion: 0.4,
    outputPerMillion: 1.8,
    webSearchPerCall: 0.0025,
  },
};

export interface PerplexityUsage {
  input_tokens?: number;
  output_tokens?: number;
  cost?: { total_cost?: number } & Record<string, unknown>;
  tool_calls_details?: Record<string, { invocation?: number } | undefined>;
}

interface PerplexitySearchResult {
  id?: number;
  url?: string;
  title?: string;
}

interface PerplexityOutputItem {
  type: string;
  results?: PerplexitySearchResult[];
  content?: { type: string; text?: string; annotations?: unknown[] }[];
}

interface PerplexityPayload {
  model?: string;
  status?: string;
  output?: PerplexityOutputItem[];
  usage?: PerplexityUsage;
}

function countSearchCalls(payload: PerplexityPayload): number {
  const details = payload.usage?.tool_calls_details ?? {};
  const reported = Object.entries(details)
    .filter(([name]) => name.includes("search"))
    .reduce((sum, [, entry]) => sum + (entry?.invocation ?? 0), 0);
  if (reported > 0) return reported;

  return (payload.output ?? []).filter((item) => item.type === "search_results").length;
}

/**
 * Стоимость ответа. Цифра провайдера берётся, если она есть; свой расчёт —
 * запасной путь, потому что записать ноль вместо стоимости нельзя.
 */
export function perplexityCostUsd(payload: PerplexityPayload, pricing: PerplexityPricing): number {
  const reported = payload.usage?.cost?.total_cost;
  if (typeof reported === "number" && Number.isFinite(reported) && reported >= 0) {
    return Math.round(reported * 1_000_000) / 1_000_000;
  }

  const usage = payload.usage ?? {};
  const total =
    ((usage.input_tokens ?? 0) / 1_000_000) * pricing.inputPerMillion +
    ((usage.output_tokens ?? 0) / 1_000_000) * pricing.outputPerMillion +
    countSearchCalls(payload) * pricing.webSearchPerCall;

  return Math.round(total * 1_000_000) / 1_000_000;
}

function messageParts(payload: PerplexityPayload) {
  return (payload.output ?? [])
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter((part) => part.type === "output_text");
}

export function extractPerplexityText(payload: PerplexityPayload): string {
  return messageParts(payload)
    .map((part) => part.text ?? "")
    .join("")
    .trim();
}

/**
 * Процитированные источники — то, на что ответ сослался, а не всё найденное.
 *
 * Поиск возвращает десяток результатов, а ответ ссылается на часть из них.
 * Засчитать все значило бы приписать источнику влияние на ответ, которого не
 * было, — и граф источников соврал бы. Так же читаются ответы остальных
 * платформ, и доли по ним остаются сравнимыми.
 *
 * Два способа сослаться, оба поддержаны: аннотации `url_citation` (их обещает
 * справочник) и номера `[n]` в тексте, указывающие на `id` результата (так
 * отвечает `fast` на деле). Дубли схлопываются по URL.
 */
export function extractPerplexityCitations(payload: PerplexityPayload): Citation[] {
  const seen = new Map<string, Citation>();

  function add(url: string | undefined, title: string | undefined): void {
    if (!url || seen.has(url)) return;
    seen.set(url, { url, ...(title ? { title } : {}) });
  }

  const parts = messageParts(payload);

  for (const part of parts) {
    for (const raw of part.annotations ?? []) {
      const annotation = raw as { type?: string; url?: string; title?: string };
      if (annotation.type === "url_citation") add(annotation.url, annotation.title);
    }
  }

  // Номер — это `id` результата. Если поисков было несколько и номера
  // повторяются, берётся первый: так их нумерует сам ответ.
  const byId = new Map<number, PerplexitySearchResult>();
  for (const item of payload.output ?? []) {
    if (item.type !== "search_results") continue;
    for (const result of item.results ?? []) {
      if (typeof result.id === "number" && !byId.has(result.id)) byId.set(result.id, result);
    }
  }

  const text = parts.map((part) => part.text ?? "").join("");
  for (const match of text.matchAll(/\[(\d{1,3})\]/g)) {
    const result = byId.get(Number(match[1]));
    if (result) add(result.url, result.title);
  }

  return [...seen.values()];
}

export interface PerplexityAdapterConfig {
  apiKey: string;
  preset?: string;
  endpoint?: string;
  pricing?: PerplexityPricing;
  /** Подменяется в тестах: сеть в них не используется никогда. */
  fetchImpl?: typeof fetch;
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

export class PerplexityAdapter implements PlatformAdapter {
  readonly platform = "perplexity" as const;

  private readonly preset: string;
  private readonly endpoint: string;
  private readonly pricing: PerplexityPricing;
  private readonly fetchImpl: typeof fetch;
  private readonly maxAttempts: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutMs: number;

  constructor(private readonly config: PerplexityAdapterConfig) {
    if (!config.apiKey) {
      throw new Error("PERPLEXITY_API_KEY is not set. Use ADAPTERS_MODE=mock or provide the key.");
    }

    this.preset = config.preset ?? DEFAULT_PERPLEXITY_PRESET;
    const pricing = config.pricing ?? PERPLEXITY_PRICING[this.preset];
    if (!pricing) {
      throw new Error(
        `No pricing for Perplexity preset "${this.preset}". Add it to PERPLEXITY_PRICING, otherwise cost per answer cannot be recorded.`,
      );
    }

    this.pricing = pricing;
    this.endpoint = config.endpoint ?? DEFAULT_PERPLEXITY_ENDPOINT;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.maxAttempts = config.maxAttempts ?? 3;
    this.sleep = config.sleep ?? defaultSleep;
    this.timeoutMs = config.timeoutMs ?? 120_000;
  }

  async execute(prompt: string, opts?: AdapterOptions): Promise<AdapterResult> {
    const startedAt = Date.now();
    const payload = await this.request(prompt, opts);

    // Недописанный ответ — не измерение: доля считалась бы по обрубку.
    if (payload.status && payload.status !== "completed") {
      throw new Error(`Perplexity returned status "${payload.status}"`);
    }

    const text = extractPerplexityText(payload);
    if (text === "") {
      throw new Error("Perplexity returned no answer text");
    }

    return adapterResultSchema.parse({
      text,
      citations: extractPerplexityCitations(payload),
      // Модель — из ответа: провайдер вправе сменить модель пресета, и без
      // отметки это выглядело бы как «изменение видимости».
      modelVersion: `${payload.model ?? "unknown"} (perplexity preset: ${this.preset})`,
      costUsd: perplexityCostUsd(payload, this.pricing),
      latencyMs: Date.now() - startedAt,
    });
  }

  private request(prompt: string, opts?: AdapterOptions): Promise<PerplexityPayload> {
    const instructions = [
      opts?.lang ? `Answer in ${opts.lang}.` : "",
      opts?.geo ? `Assume the user is in ${opts.geo}.` : "",
    ]
      .filter(Boolean)
      .join(" ");

    return postJson<PerplexityPayload>({
      provider: "Perplexity",
      url: this.endpoint,
      headers: { Authorization: `Bearer ${this.config.apiKey}` },
      body: JSON.stringify({
        preset: this.preset,
        input: prompt,
        ...(instructions ? { instructions } : {}),
      }),
      fetchImpl: this.fetchImpl,
      maxAttempts: this.maxAttempts,
      sleep: this.sleep,
      timeoutMs: this.timeoutMs,
    });
  }
}
