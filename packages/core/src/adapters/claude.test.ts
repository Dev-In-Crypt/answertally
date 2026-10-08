import { describe, expect, it, vi } from "vitest";
import {
  ClaudeAdapter,
  CLAUDE_PRICING,
  claudeCostUsd,
  countClaudeSearches,
  DEFAULT_CLAUDE_MODEL,
  extractClaudeCitations,
  extractClaudeText,
} from "./claude";

/**
 * Сеть не используется: fetch подменяется.
 *
 * ВАЖНО: форма ответа взята из документации Messages API, а не с живого
 * вызова — ключа на момент написания не было. Пока живой прогон не сделан,
 * тесты доказывают только то, что мы правильно читаем ожидаемый формат.
 */

const HAIKU = CLAUDE_PRICING["claude-haiku-4-5-20251001"]!;

function apiResponse(overrides: Record<string, unknown> = {}) {
  return {
    model: "claude-haiku-4-5-20251001",
    stop_reason: "end_turn",
    content: [
      { type: "text", text: "Let me look that up." },
      { type: "server_tool_use", id: "s1", name: "web_search", input: { query: "best crm" } },
      {
        type: "web_search_tool_result",
        tool_use_id: "s1",
        content: [
          { type: "web_search_result", url: "https://www.g2.com/categories/crm", title: "G2" },
          { type: "web_search_result", url: "https://noise.example/never-cited", title: "Noise" },
        ],
      },
      { type: "server_tool_use", id: "s2", name: "web_search", input: { query: "crm pricing" } },
      // Один связный текст, порезанный по границам цитат.
      {
        type: "text",
        text: "Startups most often pick HubSpot",
        citations: [
          {
            type: "web_search_result_location",
            url: "https://www.g2.com/categories/crm",
            title: "Best CRM Software",
            cited_text: "…",
          },
        ],
      },
      {
        type: "text",
        text: ", with Pipedrive and AcmeCRM close behind.",
        citations: [
          {
            type: "web_search_result_location",
            url: "https://www.hubspot.com/products/crm",
            title: "HubSpot CRM",
            cited_text: "…",
          },
          // Тот же источник процитирован повторно.
          {
            type: "web_search_result_location",
            url: "https://www.g2.com/categories/crm",
            title: "Best CRM Software",
            cited_text: "…",
          },
        ],
      },
    ],
    usage: { input_tokens: 5_000, output_tokens: 700, server_tool_use: { web_search_requests: 2 } },
    ...overrides,
  };
}

function fetchReturning(payload: unknown, status = 200) {
  return vi.fn().mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(payload),
    text: () => Promise.resolve(typeof payload === "string" ? payload : JSON.stringify(payload)),
  } as Response);
}

function adapter(fetchImpl: typeof fetch, overrides: Record<string, unknown> = {}) {
  return new ClaudeAdapter({
    apiKey: "test-key",
    // Тесты в этом файле проверяют разбор ответа и цены против фикстуры
    // `apiResponse()`, которая помечена как ответ Haiku, — модель здесь
    // зафиксирована явно, а дефолт продукта проверяется отдельно ниже.
    model: "claude-haiku-4-5-20251001",
    fetchImpl,
    sleep: () => Promise.resolve(),
    ...overrides,
  });
}

describe("claudeCostUsd", () => {
  it("складывает токены и поиск", () => {
    // 5000/1e6*1 + 700/1e6*5 + 2/1000*10 = 0.005 + 0.0035 + 0.02.
    const cost = claudeCostUsd({ input_tokens: 5_000, output_tokens: 700 }, 2, HAIKU);

    expect(cost).toBeCloseTo(0.0285, 6);
  });

  it("поиск дороже токенов — как и у ChatGPT", () => {
    const usage = { input_tokens: 5_000, output_tokens: 700 };
    const tokensOnly = claudeCostUsd(usage, 0, HAIKU);
    const searchOnly = claudeCostUsd(usage, 2, HAIKU) - tokensOnly;

    expect(searchOnly).toBeGreaterThan(tokensOnly);
  });

  it("пустой расход даёт ноль", () => {
    expect(claudeCostUsd({}, 0, HAIKU)).toBe(0);
  });
});

describe("разбор ответа", () => {
  it("текстовые блоки склеиваются без разделителя", () => {
    // Иначе предложение рвалось бы посреди слова на границе цитаты.
    expect(extractClaudeText(apiResponse())).toContain(
      "Startups most often pick HubSpot, with Pipedrive and AcmeCRM close behind.",
    );
  });

  it("служебные блоки в текст не попадают", () => {
    expect(extractClaudeText(apiResponse())).not.toContain("best crm");
  });

  it("цитаты — то, на что сослались, а не всё найденное", () => {
    const urls = extractClaudeCitations(apiResponse()).map((citation) => citation.url);

    expect(urls).toEqual([
      "https://www.g2.com/categories/crm",
      "https://www.hubspot.com/products/crm",
    ]);
    expect(urls).not.toContain("https://noise.example/never-cited");
  });

  it("цитаты схлопываются по URL и несут заголовок", () => {
    const citations = extractClaudeCitations(apiResponse());

    expect(citations).toHaveLength(2);
    expect(citations[0]).toEqual({
      url: "https://www.g2.com/categories/crm",
      title: "Best CRM Software",
    });
  });

  it("поиски берутся из счётчика расхода, а без него — по блокам", () => {
    expect(countClaudeSearches(apiResponse())).toBe(2);
    expect(
      countClaudeSearches(apiResponse({ usage: { input_tokens: 1, output_tokens: 1 } })),
    ).toBe(2);
    expect(countClaudeSearches({ content: [] })).toBe(0);
  });
});

describe("ClaudeAdapter", () => {
  it("возвращает результат по контракту C1", async () => {
    const result = await adapter(fetchReturning(apiResponse()) as unknown as typeof fetch).execute(
      "best CRM",
    );

    expect(result.text).toContain("AcmeCRM");
    expect(result.citations).toHaveLength(2);
    expect(result.costUsd).toBeCloseTo(0.0285, 6);
  });

  it("потолок поисков входит в отметку версии", async () => {
    // Он меняет и число источников, и состав ответа: без отметки сдвиг
    // читался бы как «изменение видимости» (инвариант 6).
    const result = await adapter(fetchReturning(apiResponse()) as unknown as typeof fetch, {
      maxSearches: 5,
    }).execute("best CRM");

    expect(result.modelVersion).toBe("claude-haiku-4-5-20251001 (max searches: 5)");
  });

  it("поиск включён с потолком, ключ идёт заголовком, а не в адресе", async () => {
    const fetchImpl = fetchReturning(apiResponse());
    await adapter(fetchImpl as unknown as typeof fetch).execute("best CRM for startups");

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const headers = init.headers as Record<string, string>;
    const body = JSON.parse(init.body as string) as {
      tools: { type: string; name: string; max_uses: number }[];
      messages: { role: string; content: string }[];
      max_tokens: number;
    };

    expect(url).toBe("https://api.anthropic.com/v1/messages");
    expect(url).not.toContain("key");
    expect(headers["x-api-key"]).toBe("test-key");
    expect(headers["anthropic-version"]).toBe("2023-06-01");
    expect(body.tools).toEqual([{ type: "web_search_20250305", name: "web_search", max_uses: 3 }]);
    expect(body.messages).toEqual([{ role: "user", content: "best CRM for startups" }]);
    expect(body.max_tokens).toBeGreaterThan(0);
  });

  it("без workspaceId заголовок не отправляется, с ним — отправляется", async () => {
    // Найдено живым вызовом: ключ, созданный на уровне организации, а не
    // привязанный к конкретному workspace, отвергает запрос ещё до модели.
    const bare = fetchReturning(apiResponse());
    await adapter(bare as unknown as typeof fetch).execute("prompt");
    expect(
      ((bare.mock.calls[0] as [string, RequestInit])[1].headers as Record<string, string>)[
        "anthropic-workspace-id"
      ],
    ).toBeUndefined();

    const scoped = fetchReturning(apiResponse());
    await adapter(scoped as unknown as typeof fetch, { workspaceId: "wrkspc_123" }).execute(
      "prompt",
    );
    expect(
      ((scoped.mock.calls[0] as [string, RequestInit])[1].headers as Record<string, string>)[
        "anthropic-workspace-id"
      ],
    ).toBe("wrkspc_123");
  });

  it("язык и регион уходят системной инструкцией", async () => {
    const fetchImpl = fetchReturning(apiResponse());
    await adapter(fetchImpl as unknown as typeof fetch).execute("prompt", {
      lang: "German",
      geo: "DE",
    });

    const body = JSON.parse(
      (fetchImpl.mock.calls[0] as [string, RequestInit])[1].body as string,
    ) as { system: string };
    expect(body.system).toBe("Answer in German. Assume the user is in DE.");
  });

  it("повторяет попытку на 429 и на 529 (провайдер перегружен)", async () => {
    for (const status of [429, 529]) {
      const fetchImpl = vi
        .fn()
        .mockResolvedValueOnce({ ok: false, status, text: () => Promise.resolve("busy") })
        .mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: () => Promise.resolve(apiResponse()),
          text: () => Promise.resolve(""),
        });

      const result = await adapter(fetchImpl as unknown as typeof fetch).execute("prompt");

      expect(fetchImpl).toHaveBeenCalledTimes(2);
      expect(result.citations).toHaveLength(2);
    }
  });

  it("на 401 не повторяет: ключ сам не заработает", async () => {
    const fetchImpl = fetchReturning("bad key", 401);

    await expect(adapter(fetchImpl as unknown as typeof fetch).execute("prompt")).rejects.toThrow(
      /401/,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("сдаётся после трёх попыток на 500", async () => {
    const fetchImpl = fetchReturning("server error", 500);

    await expect(adapter(fetchImpl as unknown as typeof fetch).execute("prompt")).rejects.toThrow(
      /500/,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("ход, остановленный на середине, — ошибка, а не обрубок в измерении", async () => {
    const fetchImpl = fetchReturning(apiResponse({ stop_reason: "pause_turn" }));

    await expect(adapter(fetchImpl as unknown as typeof fetch).execute("prompt")).rejects.toThrow(
      /paused/,
    );
  });

  it("ответ без текста — ошибка, а не пустое измерение", async () => {
    const fetchImpl = fetchReturning(apiResponse({ content: [] }));

    await expect(adapter(fetchImpl as unknown as typeof fetch).execute("prompt")).rejects.toThrow(
      /no answer text/,
    );
  });

  it("без ключа адаптер не создаётся", () => {
    expect(() => new ClaudeAdapter({ apiKey: "" })).toThrow(/ANTHROPIC_API_KEY/);
  });

  it("модель без прайса отклоняется", () => {
    expect(() => new ClaudeAdapter({ apiKey: "k", model: "claude-future" })).toThrow(/pricing/i);
  });

  it("без явной модели берётся Haiku 5.5 (решение фаундера 08.10.2026)", () => {
    // Замер: бренд называется так же часто, как у Sonnet 5, при цене в 4.5 раза ниже.
    expect(new ClaudeAdapter({ apiKey: "k" })).toMatchObject({ platform: "claude" });
    expect(DEFAULT_CLAUDE_MODEL).toBe("claude-haiku-5-5");
    expect(CLAUDE_PRICING["claude-haiku-5-5"]).toEqual({
      inputPerMillion: 0.1,
      outputPerMillion: 0.5,
      webSearchPerThousandCalls: 10,
    });
  });

  it("дефолтная модель считает стоимость по цене Haiku 5.5", async () => {
    const fetchImpl = fetchReturning(apiResponse({ model: "claude-haiku-5-5" }));
    // Без override модели — то, что реально уйдёт в прод без явной настройки.
    const result = await new ClaudeAdapter({
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: () => Promise.resolve(),
    }).execute("best CRM");

    // 5000/1e6*0.1 + 700/1e6*0.5 + 2/1000*10 = 0.0005 + 0.00035 + 0.02.
    expect(result.costUsd).toBeCloseTo(0.02085, 6);
  });
});
