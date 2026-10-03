import { describe, expect, it, vi } from "vitest";
import { countGrokSearches, GROK_PRICING, GrokAdapter, grokCostUsd } from "./grok";

/**
 * Сеть не используется: fetch подменяется.
 *
 * ВАЖНО: форма ответа и прайс взяты из документации и памяти, а не с живого
 * вызова — ключа на момент написания не было. Тесты доказывают только то, что
 * мы правильно читаем ожидаемый формат.
 */

const FAST = GROK_PRICING["grok-4.20-0309-non-reasoning"]!;

function apiResponse(overrides: Record<string, unknown> = {}) {
  return {
    model: "grok-4.20-0309-non-reasoning",
    output: [
      { type: "web_search_call", status: "completed" },
      { type: "web_search_call", status: "completed" },
      {
        type: "message",
        content: [
          {
            type: "output_text",
            text: "Startups often pick HubSpot; AcmeCRM is a lighter alternative.",
            annotations: [
              { type: "url_citation", url: "https://www.g2.com/categories/crm", title: "G2" },
              {
                type: "url_citation",
                url: "https://www.hubspot.com/products/crm",
                title: "HubSpot",
              },
              // Тот же источник ещё раз.
              { type: "url_citation", url: "https://www.g2.com/categories/crm", title: "G2" },
            ],
          },
        ],
      },
    ],
    usage: { input_tokens: 8_000, output_tokens: 600 },
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
  return new GrokAdapter({
    apiKey: "test-key",
    fetchImpl,
    sleep: () => Promise.resolve(),
    ...overrides,
  });
}

describe("grokCostUsd", () => {
  it("складывает токены и поиск", () => {
    // 8000/1e6*1.25 + 600/1e6*2.5 + 2/1000*5 = 0.01 + 0.0015 + 0.01.
    expect(grokCostUsd({ input_tokens: 8_000, output_tokens: 600 }, 2, FAST)).toBeCloseTo(
      0.0215,
      6,
    );
  });

  it("пустой расход даёт ноль", () => {
    expect(grokCostUsd({}, 0, FAST)).toBe(0);
  });
});

describe("разбор ответа", () => {
  it("вызовы поиска считаются по элементам вывода", () => {
    expect(countGrokSearches(apiResponse())).toBe(2);
    expect(countGrokSearches({ output: [{ type: "message" }] })).toBe(0);
  });
});

describe("GrokAdapter", () => {
  it("возвращает результат по контракту C1", async () => {
    const result = await adapter(fetchReturning(apiResponse()) as unknown as typeof fetch).execute(
      "best CRM",
    );

    expect(result.text).toContain("AcmeCRM");
    // Дубли схлопнуты по URL.
    expect(result.citations).toHaveLength(2);
    expect(result.modelVersion).toBe("grok-4.20-0309-non-reasoning");
    expect(result.costUsd).toBeCloseTo(0.0215, 6);
  });

  it("поиск включён, ключ идёт заголовком авторизации", async () => {
    const fetchImpl = fetchReturning(apiResponse());
    await adapter(fetchImpl as unknown as typeof fetch).execute("best CRM for startups");

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as {
      tools: unknown[];
      input: string;
      max_output_tokens: number;
      max_turns: number;
    };

    expect(url).toBe("https://api.x.ai/v1/responses");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer test-key");
    expect(body.tools).toEqual([{ type: "web_search" }]);
    expect(body.input).toBe("best CRM for startups");
    // Вопрос задаёт агентство — длина ответа и число ходов ограничены.
    expect(body.max_output_tokens).toBe(8000);
    expect(body.max_turns).toBe(5);
  });

  it("повторяет попытку на 429", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429, text: () => Promise.resolve("limit") })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(apiResponse()),
        text: () => Promise.resolve(""),
      });

    const result = await adapter(fetchImpl as unknown as typeof fetch).execute("prompt");

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.citations).toHaveLength(2);
  });

  it("на 403 не повторяет: доступ сам не появится", async () => {
    const fetchImpl = fetchReturning("forbidden", 403);

    await expect(adapter(fetchImpl as unknown as typeof fetch).execute("prompt")).rejects.toThrow(
      /403/,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("ответ без текста — ошибка, а не пустое измерение", async () => {
    const fetchImpl = fetchReturning(apiResponse({ output: [{ type: "web_search_call" }] }));

    await expect(adapter(fetchImpl as unknown as typeof fetch).execute("prompt")).rejects.toThrow(
      /no answer text/,
    );
  });

  it("без ключа адаптер не создаётся", () => {
    expect(() => new GrokAdapter({ apiKey: "" })).toThrow(/XAI_API_KEY/);
  });

  it("модель без прайса отклоняется", () => {
    expect(() => new GrokAdapter({ apiKey: "k", model: "grok-future" })).toThrow(/pricing/i);
  });
});
