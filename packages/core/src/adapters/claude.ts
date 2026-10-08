import type { AdapterOptions, AdapterResult, Citation, PlatformAdapter } from "./types";
import { adapterResultSchema } from "./types";
import { DEFAULT_RETRYABLE_STATUSES, defaultSleep, postJson } from "./http";

/**
 * Живой адаптер Claude: Messages API с серверным инструментом веб-поиска.
 *
 * Как и у ChatGPT, поиск обязателен: без него модель отвечает по памяти, а
 * измеряется ответ со ссылками на источники. Цитаты приходят внутри текстовых
 * блоков ответа — по ним и строится граф источников.
 *
 * ВАЖНО: форма ответа взята из документации, а не с живого вызова — ключа на
 * момент написания не было. Пока `live-check` не прогнан, адаптер считается
 * непроверенным.
 */

export const DEFAULT_CLAUDE_ENDPOINT = "https://api.anthropic.com/v1/messages";

/** Версия API — заголовок, а не часть адреса; провайдер требует его в каждом запросе. */
export const CLAUDE_API_VERSION = "2023-06-01";

/**
 * Версия инструмента поиска. Вынесена в конфиг: провайдер выпускает новые
 * версии инструмента рядом со старыми, и смена — правка переменной окружения,
 * а не релиз.
 */
export const DEFAULT_CLAUDE_SEARCH_TOOL = "web_search_20250305";

/**
 * Модель по умолчанию — Haiku 5.5 (решение фаундера 08.10.2026).
 *
 * Раньше стоял Sonnet 5: Haiku 4.5 слабее читал результаты поиска. Замер
 * 08.10.2026 на 10 одинаковых вопросах: Haiku 5.5 называет бренд так же
 * часто (7 из 10 у обоих), приводит на ~20% меньше источников (5.9 против
 * 7.4) и стоит $0.016 за ответ против $0.074. При такой цене Claude входит
 * в набор по умолчанию и весит 1 проверку, как ChatGPT. Модель одна на всех
 * тарифах: иначе переход клиента на старший тариф ломал бы его ряд сменой
 * модели. На сайте модель не называется — только «Claude».
 */
export const DEFAULT_CLAUDE_MODEL = "claude-haiku-5-5";

/**
 * Сколько раз за один ответ модели разрешено ходить в поиск.
 *
 * Лимит стоит явно по той же причине, что и уровень рассуждений у ChatGPT:
 * число обращений к поиску определяет и стоимость ответа, и то, сколько
 * источников вообще попадёт в диагностику. Без потолка модель сама решает,
 * сколько искать, — и сравнимость измерений между неделями теряется.
 */
export const DEFAULT_CLAUDE_MAX_SEARCHES = 3;

export interface ClaudePricing {
  inputPerMillion: number;
  outputPerMillion: number;
  webSearchPerThousandCalls: number;
}

/**
 * Прайс на 1M токенов и на 1000 поисков. Модель без строки здесь адаптер
 * отвергает: стоимость каждого ответа обязана записываться (инвариант 6).
 * Чтобы измерять другой моделью, сначала занесите её прайс.
 */
export const CLAUDE_PRICING: Record<string, ClaudePricing> = {
  // Сверено по platform.claude.com/docs/en/about-claude/pricing, 2026-09-22.
  "claude-sonnet-5": {
    inputPerMillion: 2,
    outputPerMillion: 10,
    webSearchPerThousandCalls: 10,
  },
  // Цена для промптов до 100 000 токенов; ответ с поиском укладывается
  // (замер 08.10.2026). Длиннее — $0.50/$2.50, тогда цена ответа занижена.
  "claude-haiku-5-5": {
    inputPerMillion: 0.1,
    outputPerMillion: 0.5,
    webSearchPerThousandCalls: 10,
  },
  "claude-haiku-4-5-20251001": {
    inputPerMillion: 1,
    outputPerMillion: 5,
    webSearchPerThousandCalls: 10,
  },
};

export interface ClaudeUsage {
  input_tokens?: number;
  output_tokens?: number;
  server_tool_use?: { web_search_requests?: number };
}

/**
 * Стоимость ответа. Поиск считается отдельным слагаемым: у ChatGPT он
 * съедает большую часть чека, и прятать его в округление нельзя.
 */
export function claudeCostUsd(
  usage: ClaudeUsage,
  searchRequests: number,
  pricing: ClaudePricing,
): number {
  const total =
    ((usage.input_tokens ?? 0) / 1_000_000) * pricing.inputPerMillion +
    ((usage.output_tokens ?? 0) / 1_000_000) * pricing.outputPerMillion +
    (searchRequests / 1000) * pricing.webSearchPerThousandCalls;

  // Шесть знаков — точность колонки cost_usd в БД.
  return Math.round(total * 1_000_000) / 1_000_000;
}

interface ClaudeBlock {
  type: string;
  text?: string;
  name?: string;
  citations?: unknown[] | null;
}

interface ClaudePayload {
  model?: string;
  content?: ClaudeBlock[];
  stop_reason?: string | null;
  usage?: ClaudeUsage;
}

/**
 * Текст ответа — склейка текстовых блоков БЕЗ разделителя: провайдер режет
 * один связный текст на куски по границам цитат, и перенос строки между ними
 * разорвал бы предложения посреди слова.
 */
export function extractClaudeText(payload: ClaudePayload): string {
  return (payload.content ?? [])
    .filter((block) => block.type === "text")
    .map((block) => block.text ?? "")
    .join("")
    .trim();
}

/**
 * Цитаты — из аннотаций текстовых блоков, то есть то, на что модель
 * действительно сослалась, а не всё, что она нашла. Так же читается ответ
 * ChatGPT, и доли по платформам остаются сравнимыми. Дубли схлопываются по URL.
 */
export function extractClaudeCitations(payload: ClaudePayload): Citation[] {
  const seen = new Map<string, Citation>();

  for (const block of payload.content ?? []) {
    if (block.type !== "text") continue;

    for (const raw of block.citations ?? []) {
      const citation = raw as { type?: string; url?: string; title?: string };
      if (citation.type !== "web_search_result_location" || !citation.url) continue;
      if (seen.has(citation.url)) continue;

      seen.set(citation.url, {
        url: citation.url,
        ...(citation.title ? { title: citation.title } : {}),
      });
    }
  }

  return [...seen.values()];
}

/**
 * Сколько раз модель ходила в поиск. Берётся из счётчика расхода, а если его
 * нет — считается по блокам вызова: по ним и выставляется счёт.
 */
export function countClaudeSearches(payload: ClaudePayload): number {
  const reported = payload.usage?.server_tool_use?.web_search_requests;
  if (typeof reported === "number") return reported;

  return (payload.content ?? []).filter(
    (block) => block.type === "server_tool_use" && block.name === "web_search",
  ).length;
}

export interface ClaudeAdapterConfig {
  apiKey: string;
  /**
   * Требуется, если ключ создан на уровне организации, а не привязан к
   * конкретному workspace: без заголовка такой ключ отвергает любой запрос
   * с `invalid_request_error` ещё до обращения к модели. Взять в консоли —
   * Settings → Workspaces → нужный workspace → его ID в адресе страницы.
   */
  workspaceId?: string;
  model?: string;
  endpoint?: string;
  searchTool?: string;
  maxSearches?: number;
  pricing?: ClaudePricing;
  /** Подменяется в тестах: сеть в них не используется никогда. */
  fetchImpl?: typeof fetch;
  maxAttempts?: number;
  sleep?: (ms: number) => Promise<void>;
  timeoutMs?: number;
}

/** К общему набору добавлен 529: так провайдер сообщает, что перегружен. */
const RETRYABLE_STATUSES: ReadonlySet<number> = new Set([...DEFAULT_RETRYABLE_STATUSES, 529]);

/** Потолок ответа. Обязателен в этом API; для измерения хватает с запасом. */
const MAX_OUTPUT_TOKENS = 4096;

export class ClaudeAdapter implements PlatformAdapter {
  readonly platform = "claude" as const;

  private readonly model: string;
  private readonly endpoint: string;
  private readonly searchTool: string;
  private readonly maxSearches: number;
  private readonly pricing: ClaudePricing;
  private readonly fetchImpl: typeof fetch;
  private readonly maxAttempts: number;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly timeoutMs: number;

  constructor(private readonly config: ClaudeAdapterConfig) {
    if (!config.apiKey) {
      throw new Error("ANTHROPIC_API_KEY is not set. Use ADAPTERS_MODE=mock or provide the key.");
    }

    this.model = config.model ?? DEFAULT_CLAUDE_MODEL;
    const pricing = config.pricing ?? CLAUDE_PRICING[this.model];
    if (!pricing) {
      throw new Error(
        `No pricing for Claude model "${this.model}". Add it to CLAUDE_PRICING, otherwise cost per answer cannot be recorded.`,
      );
    }

    this.pricing = pricing;
    this.endpoint = config.endpoint ?? DEFAULT_CLAUDE_ENDPOINT;
    this.searchTool = config.searchTool ?? DEFAULT_CLAUDE_SEARCH_TOOL;
    this.maxSearches = config.maxSearches ?? DEFAULT_CLAUDE_MAX_SEARCHES;
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.maxAttempts = config.maxAttempts ?? 3;
    this.sleep = config.sleep ?? defaultSleep;
    this.timeoutMs = config.timeoutMs ?? 120_000;
  }

  async execute(prompt: string, opts?: AdapterOptions): Promise<AdapterResult> {
    const startedAt = Date.now();
    const payload = await this.request(prompt, opts);

    /**
     * `pause_turn` — провайдер остановил длинный ход с серверным инструментом
     * и ждёт продолжения. Отдать недописанный текст как ответ нельзя: доля
     * упоминаний считалась бы по обрубку. Задача упадёт и повторится.
     */
    if (payload.stop_reason === "pause_turn") {
      throw new Error("Claude paused the turn before finishing the answer");
    }

    const text = extractClaudeText(payload);
    if (text === "") {
      throw new Error("Claude returned no answer text");
    }

    return adapterResultSchema.parse({
      text,
      citations: extractClaudeCitations(payload),
      // Потолок поисков входит в отметку версии: он меняет и число источников,
      // и состав ответа, то есть ровно то, что мы измеряем (инвариант 6).
      modelVersion: `${payload.model ?? this.model} (max searches: ${this.maxSearches})`,
      costUsd: claudeCostUsd(payload.usage ?? {}, countClaudeSearches(payload), this.pricing),
      latencyMs: Date.now() - startedAt,
    });
  }

  private request(prompt: string, opts?: AdapterOptions): Promise<ClaudePayload> {
    const instructions = [
      opts?.lang ? `Answer in ${opts.lang}.` : "",
      opts?.geo ? `Assume the user is in ${opts.geo}.` : "",
    ]
      .filter(Boolean)
      .join(" ");

    const body = JSON.stringify({
      model: this.model,
      max_tokens: MAX_OUTPUT_TOKENS,
      ...(instructions ? { system: instructions } : {}),
      messages: [{ role: "user", content: prompt }],
      tools: [{ type: this.searchTool, name: "web_search", max_uses: this.maxSearches }],
    });

    return postJson<ClaudePayload>({
      provider: "Claude",
      url: this.endpoint,
      headers: {
        // Ключ идёт заголовком, а не в адресе: в адресе он утёк бы в логи прокси.
        "x-api-key": this.config.apiKey,
        "anthropic-version": CLAUDE_API_VERSION,
        ...(this.config.workspaceId
          ? { "anthropic-workspace-id": this.config.workspaceId }
          : {}),
      },
      body,
      fetchImpl: this.fetchImpl,
      maxAttempts: this.maxAttempts,
      sleep: this.sleep,
      timeoutMs: this.timeoutMs,
      retryableStatuses: RETRYABLE_STATUSES,
    });
  }
}
