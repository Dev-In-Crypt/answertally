import type { AdapterOptions, AdapterResult, PlatformAdapter } from "./types";
import { adapterResultSchema } from "./types";
import { defaultSleep, postJson } from "./http";

/**
 * Google AI Overviews и AI Mode через поставщика выдачи DataForSEO.
 *
 * У Google нет API для этих ответов: поставщик снимает их со страницы
 * поиска и отдаёт текст ответа и ссылки на источники. Решение фаундера
 * 07.10.2026 (вариант «c»): это опция агентства, по умолчанию выключена, а
 * источник данных назван мелкой сноской в отчёте и в документации.
 *
 * Форма ответа снята с живого вызова 07.10.2026: элемент `ai_overview` с
 * `markdown` и `references` (url, title) — одинаково в выдаче AI Mode и в
 * блоке AI Overview обычной выдачи.
 *
 * AI Overview показывается не на каждый вопрос. Нет блока — ответ записан
 * как «блока не было»: бренд в нём не назван, и это правда о том, что видел
 * покупатель. Платная часть при этом всё равно списана поставщиком.
 */

export type GoogleSurface = "ai-overviews" | "ai-mode";

export const DATAFORSEO_ENDPOINTS: Record<GoogleSurface, string> = {
  "ai-mode": "https://api.dataforseo.com/v3/serp/google/ai_mode/live/advanced",
  "ai-overviews": "https://api.dataforseo.com/v3/serp/google/organic/live/advanced",
};

/** Текст ответа, когда Google не показал блок: в нём нет ничьего бренда. */
export const NO_AI_OVERVIEW_TEXT = "Google showed no AI answer for this question.";

/** США, английский — так спрашивает покупатель наших агентств, как и в генераторе вопросов. */
const DEFAULT_LOCATION_CODE = 2840;
const DEFAULT_LANGUAGE_CODE = "en";

interface DataForSeoItem {
  type?: string;
  markdown?: string | null;
  references?: { url?: string | null; title?: string | null }[] | null;
}

interface DataForSeoPayload {
  version?: string;
  status_code?: number;
  status_message?: string;
  tasks?:
    | {
        status_code?: number;
        status_message?: string;
        cost?: number;
        result?: { items?: DataForSeoItem[] | null }[] | null;
      }[]
    | null;
}

export interface DataForSeoAdapterConfig {
  /** Готовое значение Basic-авторизации: base64 от `login:password`. */
  auth: string;
  surface: GoogleSurface;
  fetchImpl?: typeof fetch;
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

/** Блок ответа ИИ из выдачи: текст и источники. Null — блока не было. */
export function extractAiAnswer(
  payload: DataForSeoPayload,
): { text: string; citations: { url: string; title?: string }[] } | null {
  const items = payload.tasks?.[0]?.result?.[0]?.items ?? [];
  const block = items.find((item) => item.type === "ai_overview");
  const text = block?.markdown?.trim();
  if (!block || !text) return null;

  const seen = new Set<string>();
  const citations: { url: string; title?: string }[] = [];
  for (const ref of block.references ?? []) {
    if (!ref.url || seen.has(ref.url) || !/^https?:\/\//.test(ref.url)) continue;
    seen.add(ref.url);
    citations.push({ url: ref.url, ...(ref.title ? { title: ref.title } : {}) });
  }
  return { text, citations };
}

export class DataForSeoAdapter implements PlatformAdapter {
  readonly platform: GoogleSurface;

  private readonly fetchImpl: typeof fetch;
  private readonly maxAttempts: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutMs: number;

  constructor(private readonly config: DataForSeoAdapterConfig) {
    if (!config.auth) {
      throw new Error("DATAFORSEO_AUTH is not set. Use ADAPTERS_MODE=mock or provide the key.");
    }
    this.platform = config.surface;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.maxAttempts = config.maxAttempts ?? 3;
    this.sleep = config.sleep ?? defaultSleep;
    this.timeoutMs = config.timeoutMs ?? 120_000;
  }

  async execute(prompt: string, _opts?: AdapterOptions): Promise<AdapterResult> {
    const startedAt = Date.now();
    const task = {
      keyword: prompt,
      location_code: DEFAULT_LOCATION_CODE,
      language_code: DEFAULT_LANGUAGE_CODE,
      // AI Overview подгружается на странице позже остальной выдачи; без
      // флага поставщик часто отдаёт выдачу без него.
      ...(this.platform === "ai-overviews" ? { load_async_ai_overview: true, depth: 10 } : {}),
    };

    const payload = await postJson<DataForSeoPayload>({
      provider: "DataForSEO",
      url: DATAFORSEO_ENDPOINTS[this.platform],
      headers: { Authorization: `Basic ${this.config.auth}` },
      body: JSON.stringify([task]),
      fetchImpl: this.fetchImpl,
      maxAttempts: this.maxAttempts,
      sleep: this.sleep,
      timeoutMs: this.timeoutMs,
    });

    const result = payload.tasks?.[0];
    // Ошибка задачи приходит с HTTP 200 и своим кодом (40104 — аккаунт не
    // подтверждён, 40200 — нет денег): это сбой, а не «Google промолчал».
    if (payload.status_code !== 20000 || !result || result.status_code !== 20000) {
      throw new Error(
        `DataForSEO task failed: ${result?.status_code ?? payload.status_code} ${result?.status_message ?? payload.status_message ?? ""}`.trim(),
      );
    }

    const answer = extractAiAnswer(payload);
    return adapterResultSchema.parse({
      text: answer?.text ?? NO_AI_OVERVIEW_TEXT,
      citations: answer?.citations ?? [],
      modelVersion: `dataforseo-google-${this.platform}-${payload.version ?? "unknown"}`,
      costUsd: result.cost ?? 0,
      latencyMs: Date.now() - startedAt,
    });
  }
}
