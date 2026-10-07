import { describe, expect, it } from "vitest";
import { DataForSeoAdapter, NO_AI_OVERVIEW_TEXT } from "./dataforseo";

/** Ответ поставщика той же формы, что живой вызов 07.10.2026. */
function payload(items: unknown[], cost = 0.004, status = 20000) {
  return {
    version: "0.1.test",
    status_code: 20000,
    tasks: [{ status_code: status, status_message: status === 20000 ? "Ok." : "Nope", cost, result: [{ items }] }],
  };
}

function fakeFetch(body: unknown): typeof fetch {
  return (async (_url: string | URL | Request, init?: RequestInit) => {
    calls.push(JSON.parse(String(init?.body)));
    return new Response(JSON.stringify(body), { status: 200 });
  }) as typeof fetch;
}
let calls: unknown[] = [];

describe("DataForSeoAdapter", () => {
  it("берёт текст и источники из блока ответа Google", async () => {
    calls = [];
    const adapter = new DataForSeoAdapter({
      auth: "x",
      surface: "ai-mode",
      fetchImpl: fakeFetch(
        payload([
          {
            type: "ai_overview",
            markdown: "Try **Graza Drizzle** for finishing.",
            references: [
              { url: "https://www.nytimes.com/wirecutter/reviews/best-olive-oil/", title: "Wirecutter" },
              { url: "https://www.nytimes.com/wirecutter/reviews/best-olive-oil/", title: "dup" },
            ],
          },
        ]),
      ),
    });

    const result = await adapter.execute("best olive oil for drizzling");

    expect(result.text).toContain("Graza");
    expect(result.citations).toEqual([
      { url: "https://www.nytimes.com/wirecutter/reviews/best-olive-oil/", title: "Wirecutter" },
    ]);
    expect(result.costUsd).toBe(0.004);
    expect(result.modelVersion).toBe("dataforseo-google-ai-mode-0.1.test");
  });

  it("нет блока AI Overview — записан ответ без брендов, а не выдумка", async () => {
    calls = [];
    const adapter = new DataForSeoAdapter({
      auth: "x",
      surface: "ai-overviews",
      fetchImpl: fakeFetch(payload([{ type: "organic" }], 0.002)),
    });

    const result = await adapter.execute("q");

    expect(result.text).toBe(NO_AI_OVERVIEW_TEXT);
    expect(result.citations).toEqual([]);
    // Блок AI Overview подгружается отдельно: без флага его часто нет.
    expect(calls[0]).toEqual([expect.objectContaining({ keyword: "q", load_async_ai_overview: true })]);
  });

  it("ошибка задачи с HTTP 200 — это сбой, а не пустой ответ", async () => {
    const adapter = new DataForSeoAdapter({
      auth: "x",
      surface: "ai-mode",
      fetchImpl: fakeFetch(payload([], 0, 40104)),
    });

    await expect(adapter.execute("q")).rejects.toThrow(/40104/);
  });

  it("внутренняя ошибка поставщика (40101) — повтор, а не потерянный ответ", async () => {
    const bodies = [payload([], 0, 40101), payload([{ type: "ai_overview", markdown: "Cal.com" }], 0.002)];
    let n = 0;
    const adapter = new DataForSeoAdapter({
      auth: "x",
      surface: "ai-overviews",
      sleep: async () => {},
      fetchImpl: (async () => new Response(JSON.stringify(bodies[n++]), { status: 200 })) as typeof fetch,
    });

    const result = await adapter.execute("q");

    expect(result.text).toBe("Cal.com");
    expect(n).toBe(2);
  });

  it("без ключа не создаётся", () => {
    expect(() => new DataForSeoAdapter({ auth: "", surface: "ai-mode" })).toThrow(/DATAFORSEO_AUTH/);
  });
});
