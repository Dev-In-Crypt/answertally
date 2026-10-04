import { describe, expect, it, vi } from "vitest";
import {
  extractCitations,
  extractText,
  openAiCostUsd,
  OpenAiAdapter,
  DEFAULT_OPENAI_MODEL,
  OPENAI_PRICING,
} from "./openai";

/**
 * Verify T13. Сеть не используется: fetch подменяется, а форма ответа взята
 * с живого вызова Responses API (gpt-5.6-luna с web_search).
 */

const LUNA = OPENAI_PRICING["gpt-5.6-luna"]!;

/** Урезанный, но настоящий ответ API: типы блоков и аннотаций — как в проде. */
function apiResponse(overrides: Record<string, unknown> = {}) {
  return {
    model: "gpt-5.6-luna-2026-07-01",
    status: "completed",
    output: [
      { type: "reasoning", summary: [] },
      { type: "web_search_call", status: "completed" },
      {
        type: "message",
        role: "assistant",
        content: [
          {
            type: "output_text",
            text: "For early-stage startups the CRMs that come up most often are HubSpot and AcmeCRM.",
            annotations: [
              {
                type: "url_citation",
                start_index: 10,
                end_index: 40,
                title: "CRM for Startups | HubSpot",
                url: "https://www.hubspot.com/products/crm/startups",
              },
              {
                type: "url_citation",
                start_index: 41,
                end_index: 70,
                title: "Best CRM software",
                url: "https://www.g2.com/categories/crm",
              },
              // Повтор того же источника: модель ссылается на него дважды.
              {
                type: "url_citation",
                start_index: 71,
                end_index: 90,
                title: "CRM for Startups | HubSpot",
                url: "https://www.hubspot.com/products/crm/startups",
              },
            ],
          },
        ],
      },
    ],
    usage: {
      input_tokens: 21_226,
      input_tokens_details: { cached_tokens: 4_403 },
      output_tokens: 1_081,
    },
    tool_usage: { web_search: { num_requests: 2 } },
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
  return new OpenAiAdapter({
    apiKey: "test-key",
    fetchImpl,
    sleep: () => Promise.resolve(),
    /**
     * Модель названа явно, а не взята из умолчания.
     *
     * Ответ ниже — запись живого вызова именно gpt-5.6-luna, и стоимость
     * проверяется по её прайсу. С умолчанием тест пересчитывал бы старую
     * запись по цене новой модели и падал бы каждый раз, когда умолчание
     * меняется, — хотя проверяет он не умолчание, а арифметику.
     */
    model: "gpt-5.6-luna",
    ...overrides,
  });
}

describe("openAiCostUsd", () => {
  it("считает по факту вызова, отдельно кэш и отдельно поиск", () => {
    // 16823/1e6*0.2 + 4403/1e6*0.02 + 1081/1e6*1.2 = 0.00474986; поиск 2*10/1000 = 0.02.
    const cost = openAiCostUsd(
      { input_tokens: 21_226, output_tokens: 1_081, input_tokens_details: { cached_tokens: 4_403 } },
      2,
      LUNA,
    );

    expect(cost).toBeCloseTo(0.02475, 6);
  });

  it("вызовы поиска стоят дороже всех токенов вместе", () => {
    const usage = { input_tokens: 20_000, output_tokens: 1_000 };

    const withSearch = openAiCostUsd(usage, 2, LUNA);
    const withoutSearch = openAiCostUsd(usage, 0, LUNA);

    expect(withSearch - withoutSearch).toBeCloseTo(0.02, 6);
    expect(withoutSearch).toBeLessThan(withSearch - withoutSearch);
  });

  it("кэшированные токены не считаются по полной цене", () => {
    const allCached = openAiCostUsd(
      { input_tokens: 10_000, output_tokens: 0, input_tokens_details: { cached_tokens: 10_000 } },
      0,
      LUNA,
    );

    expect(allCached).toBeCloseTo(0.0002, 6);
  });

  it("без расхода — ноль, а не отрицательное число", () => {
    expect(openAiCostUsd({ input_tokens: 0, output_tokens: 0 }, 0, LUNA)).toBe(0);
  });
});

describe("разбор ответа", () => {
  it("текст собирается только из блоков message", () => {
    expect(extractText(apiResponse())).toContain("HubSpot and AcmeCRM");
  });

  it("цитаты берутся из url_citation и схлопываются по URL", () => {
    const citations = extractCitations(apiResponse());

    expect(citations).toHaveLength(2);
    expect(citations[0]).toEqual({
      url: "https://www.hubspot.com/products/crm/startups",
      title: "CRM for Startups | HubSpot",
    });
    expect(citations.map((c) => c.url)).toContain("https://www.g2.com/categories/crm");
  });

  it("ответ без цитат не ломает разбор — это валидный случай", () => {
    const payload = apiResponse({
      output: [
        {
          type: "message",
          content: [{ type: "output_text", text: "No sources for this one.", annotations: [] }],
        },
      ],
    });

    expect(extractCitations(payload)).toEqual([]);
    expect(extractText(payload)).toBe("No sources for this one.");
  });
});

describe("модель по умолчанию", () => {
  it("имеет прайс: без него адаптер не стартует вовсе", () => {
    /**
     * Стоимость ответа обязана записываться к каждому ответу, поэтому
     * адаптер отказывается работать с моделью, цены которой не знает.
     * Поднять умолчание на новую модель и забыть прайс — значит уронить
     * измерения в бою, а не в тесте.
     */
    expect(OPENAI_PRICING[DEFAULT_OPENAI_MODEL]).toBeDefined();
  });
});

describe("OpenAiAdapter", () => {
  it("возвращает результат по контракту C1", async () => {
    const fetchImpl = fetchReturning(apiResponse());
    const result = await adapter(fetchImpl as unknown as typeof fetch).execute(
      "best CRM for startups",
    );

    expect(result.text).toContain("HubSpot");
    expect(result.citations).toHaveLength(2);
    expect(result.costUsd).toBeCloseTo(0.02475, 6);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("версия модели берётся из ответа и несёт уровень рассуждений", async () => {
    const fetchImpl = fetchReturning(apiResponse());
    const result = await adapter(fetchImpl as unknown as typeof fetch).execute("prompt");

    // Алиас «gpt-5.6-luna» провайдер вправе увести на другую сборку, а уровень
    // рассуждений меняет число источников — измерения сравнимы только внутри
    // одной пары «сборка + уровень».
    expect(result.modelVersion).toBe("gpt-5.6-luna-2026-07-01 (reasoning: medium)");
  });

  it("уровень рассуждений задаётся явно, а не оставляется провайдеру", async () => {
    const fetchImpl = fetchReturning(apiResponse());
    await adapter(fetchImpl as unknown as typeof fetch).execute("prompt");

    const body = JSON.parse((fetchImpl.mock.calls[0]?.[1] as RequestInit).body as string) as {
      reasoning: { effort: string };
    };

    expect(body.reasoning).toEqual({ effort: "medium" });
  });

  it("выбранный уровень доезжает и до запроса, и до стемпа", async () => {
    const fetchImpl = fetchReturning(apiResponse());
    const result = await adapter(fetchImpl as unknown as typeof fetch, {
      reasoningEffort: "low",
    }).execute("prompt");

    const body = JSON.parse((fetchImpl.mock.calls[0]?.[1] as RequestInit).body as string) as {
      reasoning: { effort: string };
    };

    expect(body.reasoning.effort).toBe("low");
    expect(result.modelVersion).toContain("(reasoning: low)");
  });

  it("веб-поиск включён в запросе — без него измерять нечего", async () => {
    const fetchImpl = fetchReturning(apiResponse());
    await adapter(fetchImpl as unknown as typeof fetch).execute("prompt");

    const body = JSON.parse((fetchImpl.mock.calls[0]?.[1] as RequestInit).body as string) as {
      tools: { type: string }[];
      model: string;
      max_output_tokens: number;
      max_tool_calls: number;
    };

    expect(body.tools).toEqual([{ type: "web_search" }]);
    expect(body.model).toBe("gpt-5.6-luna");
    // Вопрос задаёт агентство: «сделай тридцать поисков» не должно проходить.
    expect(body.max_output_tokens).toBe(16000);
    expect(body.max_tool_calls).toBe(5);
  });

  it("повторяет попытку на 429 и отдаёт результат", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce({
        ok: false,
        status: 429,
        text: () => Promise.resolve("rate limited"),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: () => Promise.resolve(apiResponse()),
        text: () => Promise.resolve(""),
      } as Response);

    const result = await adapter(fetchImpl as unknown as typeof fetch).execute("prompt");

    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(result.citations).toHaveLength(2);
  });

  it("сдаётся после трёх попыток и объясняет причину", async () => {
    const fetchImpl = fetchReturning("upstream is down", 503);

    await expect(adapter(fetchImpl as unknown as typeof fetch).execute("prompt")).rejects.toThrow(
      /503/,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("на 400 не повторяет: тот же запрос даст тот же ответ", async () => {
    const fetchImpl = fetchReturning("bad request", 400);

    await expect(adapter(fetchImpl as unknown as typeof fetch).execute("prompt")).rejects.toThrow(
      /400/,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("пустой ответ — ошибка, а не пустое измерение", async () => {
    const fetchImpl = fetchReturning(apiResponse({ output: [] }));

    await expect(adapter(fetchImpl as unknown as typeof fetch).execute("prompt")).rejects.toThrow(
      /no answer text/,
    );
  });

  it("без ключа адаптер не создаётся", () => {
    expect(() => new OpenAiAdapter({ apiKey: "" })).toThrow(/OPENAI_API_KEY/);
  });

  it("модель без прайса отклоняется: стоимость ответа обязана записываться", () => {
    expect(() => new OpenAiAdapter({ apiKey: "k", model: "gpt-future" })).toThrow(/pricing/i);
  });
});
