import type { AdapterOptions, AdapterResult, PlatformAdapter } from "./types";
import { adapterResultSchema } from "./types";
import { defaultSleep, postJson } from "./http";
import { normalizeDomain } from "../sources/domains";

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
  domain?: string | null;
  url?: string | null;
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

/**
 * «Отпечаток» страницы: домены органической десятки, по порядку, без повторов.
 *
 * С конца сентября 2026 Google отдаёт автоматическим запросам «отравленную»
 * выдачу: страница выглядит обычной, но органика в ней почти вся чужая, и
 * AI Overview на ней показывается реже. Такой ответ записался бы как «блока
 * не было» и занизил бы видимость. Отличить его можно только сравнением с
 * другими чтениями того же вопроса (см. isSuspectSerp). Пусто — сравнивать
 * не с чем: органики в ответе нет (AI Mode её не отдаёт).
 */
export function extractOrganicDomains(payload: DataForSeoPayload): string[] {
  const items = payload.tasks?.[0]?.result?.[0]?.items ?? [];
  const domains: string[] = [];
  for (const item of items) {
    if (item.type !== "organic" || domains.length >= 10) continue;
    const raw = item.domain || item.url;
    // ponytail: хост без www, а не регистрируемый домен (eTLD+1): blog.x.com и
    // x.com считаются разными. Для сравнения двух десяток одного вопроса этого
    // хватает; список публичных суффиксов — если начнёт давать ложные срабатывания.
    const domain = raw ? normalizeDomain(raw) : "";
    if (domain && !domains.includes(domain)) domains.push(domain);
  }
  return domains;
}

/**
 * Порог сходства десяток (Jaccard), ниже которого чтения «про разное».
 *
 * По замерам Nozzle/cloro, обычная выдача между чтениями сохраняет ≈88%
 * сайтов десятки (Jaccard ≈0.79), отравленная — ≈20% (≈0.11). 0.3 — между
 * ними, ближе к отравленной: лучше пропустить отравленное чтение, чем
 * выбросить настоящее.
 * ponytail: один порог на все вопросы; у новостных запросов выдача живая и
 * может проваливаться ниже — тогда порог по вопросу из истории его чтений.
 */
export const SERP_SIMILARITY_THRESHOLD = 0.3;

/** Jaccard двух наборов доменов: доля общих среди всех. */
export function serpSimilarity(a: readonly string[], b: readonly string[]): number {
  const setB = new Set(b);
  const shared = new Set(a.filter((domain) => setB.has(domain))).size;
  const union = new Set([...a, ...b]).size;
  return union === 0 ? 1 : shared / union;
}

/**
 * Похоже ли чтение на отравленную выдачу.
 *
 * Сравнивается с недавними чтениями того же вопроса. Судить можно, только
 * если хотя бы два из них согласны между собой: иначе выдача по вопросу
 * просто живая (или среди образцов сам отравленный), и «не похоже на
 * образцы» ничего не значит. Подозрительно — не похоже ни на один из
 * согласных образцов.
 */
export function isSuspectSerp(candidate: readonly string[], references: readonly (readonly string[])[]): boolean {
  if (candidate.length === 0) return false;
  const usable = references.filter((ref) => ref.length > 0);
  const consensus = usable.filter((ref, i) =>
    usable.some((other, j) => i !== j && serpSimilarity(ref, other) >= SERP_SIMILARITY_THRESHOLD),
  );
  if (consensus.length < 2) return false;
  return consensus.every((ref) => serpSimilarity(candidate, ref) < SERP_SIMILARITY_THRESHOLD);
}

/** Сбой поставщика, который проходит при повторе (в отличие от «нет денег»). */
function isTransient(payload: DataForSeoPayload): boolean {
  const code = payload.tasks?.[0]?.status_code ?? payload.status_code ?? 0;
  return code === 40101 || code >= 50000;
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

    const send = () =>
      postJson<DataForSeoPayload>({
        provider: "DataForSEO",
        url: DATAFORSEO_ENDPOINTS[this.platform],
        headers: { Authorization: `Basic ${this.config.auth}` },
        body: JSON.stringify([task]),
        fetchImpl: this.fetchImpl,
        maxAttempts: this.maxAttempts,
        sleep: this.sleep,
        timeoutMs: this.timeoutMs,
      });

    let payload = await send();
    // 40101 «Internal SE Server Error» — сбой поставщика на его стороне: в замере
    // 07.10.2026 так упал каждый четвёртый запрос, повтор проходит.
    for (let attempt = 1; attempt < this.maxAttempts && isTransient(payload); attempt++) {
      await this.sleep(2_000 * attempt);
      payload = await send();
    }

    const result = payload.tasks?.[0];
    // Ошибка задачи приходит с HTTP 200 и своим кодом (40104 — аккаунт не
    // подтверждён, 40200 — нет денег): это сбой, а не «Google промолчал».
    if (payload.status_code !== 20000 || !result || result.status_code !== 20000) {
      throw new Error(
        `DataForSEO task failed: ${result?.status_code ?? payload.status_code} ${result?.status_message ?? payload.status_message ?? ""}`.trim(),
      );
    }

    const answer = extractAiAnswer(payload);
    const serpDomains = extractOrganicDomains(payload);
    return adapterResultSchema.parse({
      text: answer?.text ?? NO_AI_OVERVIEW_TEXT,
      citations: answer?.citations ?? [],
      modelVersion: `dataforseo-google-${this.platform}-${payload.version ?? "unknown"}`,
      costUsd: result.cost ?? 0,
      latencyMs: Date.now() - startedAt,
      ...(serpDomains.length > 0 ? { serpDomains } : {}),
    });
  }
}
