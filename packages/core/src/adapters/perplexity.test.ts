import { describe, expect, it, vi } from "vitest";
import {
  extractPerplexityCitations,
  extractPerplexityText,
  PerplexityAdapter,
  PERPLEXITY_PRICING,
  perplexityCostUsd,
} from "./perplexity";

/**
 * Сеть не используется: fetch подменяется.
 *
 * Форма ответа снята с живого вызова Agent API (пресет `fast`, 2026-09-22):
 * аннотаций в тексте нет, источники — отдельный элемент `search_results`, а
 * текст ссылается на них номерами `[n]`, совпадающими с `id` результата.
 */

const FAST = PERPLEXITY_PRICING["fast"]!;

function result(id: number, host: string) {
  return {
    id,
    url: `https://${host}/page`,
    title: `${host} title`,
    snippet: "…",
    source: "web",
  };
}

function apiResponse(overrides: Record<string, unknown> = {}) {
  return {
    model: "openai/gpt-5.6-luna",
    status: "completed",
    output: [
      {
        type: "search_results",
        queries: ["best CRM for startups"],
        results: [
          result(1, "www.reddit.com"),
          result(2, "never-cited.example"),
          result(3, "www.hubspot.com"),
          result(4, "www.g2.com"),
        ],
      },
      {
        type: "message",
        role: "assistant",
        status: "completed",
        content: [
          {
            type: "output_text",
            text: "HubSpot is the default pick.[3][4] AcmeCRM suits developer-heavy teams.[1] See also HubSpot again.[3]",
            annotations: [],
          },
        ],
      },
    ],
    usage: {
      input_tokens: 3000,
      output_tokens: 331,
      cost: { currency: "USD", total_cost: 0.00397, tool_calls_cost: 0.0025 },
      tool_calls_details: { search_web: { cost_usd: 0.0025, invocation: 1 } },
    },
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
  return new PerplexityAdapter({
    apiKey: "test-key",
    fetchImpl,
    sleep: () => Promise.resolve(),
    ...overrides,
  });
}

describe("perplexityCostUsd", () => {
  it("берёт цифру провайдера, если она есть", () => {
    expect(perplexityCostUsd(apiResponse(), FAST)).toBeCloseTo(0.00397, 6);
  });

  it("без цифры провайдера считает сам по верхним ценам, а не пишет ноль", () => {
    // 3000/1e6*0.4 + 331/1e6*1.8 + 1*0.0025 = 0.0012 + 0.0005958 + 0.0025.
    const payload = apiResponse({
      usage: {
        input_tokens: 3000,
        output_tokens: 331,
        tool_calls_details: { search_web: { invocation: 1 } },
      },
    });

    expect(perplexityCostUsd(payload, FAST)).toBeCloseTo(0.004296, 6);
  });

  it("без счётчика вызовов поиски считаются по элементам search_results", () => {
    const payload = apiResponse({ usage: { input_tokens: 0, output_tokens: 0 } });
    expect(perplexityCostUsd(payload, FAST)).toBeCloseTo(0.0025, 6);
  });
});

describe("разбор ответа", () => {
  it("текст берётся из элемента message", () => {
    expect(extractPerplexityText(apiResponse())).toContain("AcmeCRM");
  });

  it("процитированы только результаты, на которые текст сослался номером", () => {
    const urls = extractPerplexityCitations(apiResponse()).map((citation) => citation.url);

    // Порядок — порядок первой ссылки в тексте; повторная [3] не дублируется.
    expect(urls).toEqual([
      "https://www.hubspot.com/page",
      "https://www.g2.com/page",
      "https://www.reddit.com/page",
    ]);
    // Найденный, но не упомянутый источник на ответ не влиял.
    expect(urls).not.toContain("https://never-cited.example/page");
  });

  it("цитата несёт заголовок результата", () => {
    expect(extractPerplexityCitations(apiResponse())[0]).toEqual({
      url: "https://www.hubspot.com/page",
      title: "www.hubspot.com title",
    });
  });

  it("номер без такого результата игнорируется, а не выдумывает источник", () => {
    const payload = apiResponse();
    const message = payload.output[1] as { content: { text: string }[] };
    message.content[0]!.text = "An answer that cites a result that does not exist.[42]";

    expect(extractPerplexityCitations(payload)).toEqual([]);
  });

  it("аннотации url_citation тоже засчитываются, если провайдер их пришлёт", () => {
    const payload = apiResponse();
    const message = payload.output[1] as { content: { text: string; annotations: unknown[] }[] };
    message.content[0]!.text = "No numeric markers here.";
    message.content[0]!.annotations = [
      { type: "url_citation", url: "https://www.capterra.com/crm", title: "Capterra" },
    ];

    expect(extractPerplexityCitations(payload)).toEqual([
      { url: "https://www.capterra.com/crm", title: "Capterra" },
    ]);
  });
});

describe("PerplexityAdapter", () => {
  it("возвращает результат по контракту C1", async () => {
    const result = await adapter(fetchReturning(apiResponse()) as unknown as typeof fetch).execute(
      "best CRM",
    );

    expect(result.text).toContain("HubSpot");
    expect(result.citations).toHaveLength(3);
    expect(result.costUsd).toBeCloseTo(0.00397, 6);
  });

  it("в версии — настоящая модель из ответа и пресет", async () => {
    // Пресет отвечает моделью OpenAI: колонка «Perplexity» не должна выдавать
    // её за собственную модель провайдера.
    const result = await adapter(fetchReturning(apiResponse()) as unknown as typeof fetch).execute(
      "best CRM",
    );

    expect(result.modelVersion).toBe("openai/gpt-5.6-luna (perplexity preset: fast)");
  });

  it("запрос уходит в Agent API с пресетом, ключ — заголовком", async () => {
    const fetchImpl = fetchReturning(apiResponse());
    await adapter(fetchImpl as unknown as typeof fetch).execute("best CRM for startups");

    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as Record<string, unknown>;

    expect(url).toBe("https://api.perplexity.ai/v1/agent");
    expect((init.headers as Record<string, string>)["Authorization"]).toBe("Bearer test-key");
    // Потолок длины и шагов задаёт пресет (8192 токена): свой ниже него
    // только выбрасывал бы оплаченные длинные ответы.
    expect(body).toEqual({ preset: "fast", input: "best CRM for startups" });
  });

  it("язык и регион уходят инструкцией", async () => {
    const fetchImpl = fetchReturning(apiResponse());
    await adapter(fetchImpl as unknown as typeof fetch).execute("prompt", {
      lang: "German",
      geo: "DE",
    });

    const body = JSON.parse(
      (fetchImpl.mock.calls[0] as [string, RequestInit])[1].body as string,
    ) as { instructions: string };
    expect(body.instructions).toBe("Answer in German. Assume the user is in DE.");
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
    expect(result.citations).toHaveLength(3);
  });

  it("на 401 не повторяет: ключ сам не заработает", async () => {
    const fetchImpl = fetchReturning("unauthorized", 401);

    await expect(adapter(fetchImpl as unknown as typeof fetch).execute("prompt")).rejects.toThrow(
      /401/,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("незавершённый ответ — ошибка, а не обрубок в измерении", async () => {
    const fetchImpl = fetchReturning(apiResponse({ status: "incomplete" }));

    await expect(adapter(fetchImpl as unknown as typeof fetch).execute("prompt")).rejects.toThrow(
      /incomplete/,
    );
  });

  it("ответ без текста — ошибка, а не пустое измерение", async () => {
    const fetchImpl = fetchReturning(apiResponse({ output: [] }));

    await expect(adapter(fetchImpl as unknown as typeof fetch).execute("prompt")).rejects.toThrow(
      /no answer text/,
    );
  });

  it("без ключа адаптер не создаётся", () => {
    expect(() => new PerplexityAdapter({ apiKey: "" })).toThrow(/PERPLEXITY_API_KEY/);
  });

  it("пресет без прайса отклоняется", () => {
    expect(() => new PerplexityAdapter({ apiKey: "k", preset: "xhigh" })).toThrow(/pricing/i);
  });
});
