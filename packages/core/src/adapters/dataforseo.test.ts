import { describe, expect, it } from "vitest";
import {
  DataForSeoAdapter,
  extractOrganicDomains,
  isSuspectSerp,
  NO_AI_OVERVIEW_TEXT,
  serpSimilarity,
} from "./dataforseo";

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

describe("extractOrganicDomains", () => {
  const cases: Array<[string, unknown[], string[]]> = [
    ["нет органики", [{ type: "ai_overview", markdown: "x" }], []],
    [
      "домен из поля domain, без www и регистра",
      [{ type: "organic", domain: "WWW.Example.com" }, { type: "organic", domain: "b.org" }],
      ["example.com", "b.org"],
    ],
    ["нет domain — хост из url", [{ type: "organic", url: "https://www.c.io/page?q=1" }], ["c.io"]],
    [
      "не органика не считается, повторы схлопываются",
      [
        { type: "paid", domain: "ads.com" },
        { type: "organic", domain: "a.com" },
        { type: "people_also_ask" },
        { type: "organic", domain: "a.com" },
        { type: "organic" },
      ],
      ["a.com"],
    ],
    [
      "только первые десять органических",
      Array.from({ length: 12 }, (_, i) => ({ type: "organic", domain: `s${i}.com` })),
      Array.from({ length: 10 }, (_, i) => `s${i}.com`),
    ],
  ];
  it.each(cases)("%s", (_name, items, expected) => {
    expect(extractOrganicDomains(payload(items) as Parameters<typeof extractOrganicDomains>[0])).toEqual(expected);
  });
});

describe("isSuspectSerp", () => {
  const top = (...ids: number[]) => ids.map((i) => `site${i}.com`);
  const normal = top(1, 2, 3, 4, 5, 6, 7, 8, 9, 10);
  // Обычная выдача между чтениями: 9 из 10 на месте.
  const drift = top(1, 2, 3, 4, 5, 6, 7, 8, 9, 11);
  // Отравленная: на месте 2 из 10.
  const poisoned = top(1, 2, 21, 22, 23, 24, 25, 26, 27, 28);

  const cases: Array<[string, string[], string[][], boolean]> = [
    ["обычное чтение среди согласных образцов", drift, [normal, drift], false],
    ["отравленное чтение против согласных образцов", poisoned, [normal, drift], true],
    ["образцов нет — судить не по чему", poisoned, [], false],
    ["один образец — не с чем сверить его самого", poisoned, [normal], false],
    ["образцы не согласны между собой", poisoned, [normal, top(31, 32, 33, 34, 35)], false],
    ["похоже хотя бы на один согласный образец", drift, [normal, normal, poisoned], false],
    [
      "отравленный образец не мешает согласным",
      top(41, 42, 43, 44, 45, 46, 47, 48, 49, 50),
      [normal, drift, poisoned],
      true,
    ],
    ["у самого чтения нет органики", [], [normal, drift], false],
    ["пустые образцы не считаются", poisoned, [normal, [], []], false],
  ];
  it.each(cases)("%s", (_name, candidate, references, expected) => {
    expect(isSuspectSerp(candidate, references)).toBe(expected);
  });

  it("порог лежит между обычным и отравленным сходством", () => {
    expect(serpSimilarity(normal, drift)).toBeGreaterThan(0.3);
    expect(serpSimilarity(normal, poisoned)).toBeLessThan(0.3);
  });
});

describe("DataForSeoAdapter: отпечаток выдачи", () => {
  it("органическая десятка уходит вместе с ответом, у AI Mode её нет", async () => {
    const overviews = new DataForSeoAdapter({
      auth: "x",
      surface: "ai-overviews",
      fetchImpl: fakeFetch(payload([{ type: "organic", domain: "a.com" }, { type: "ai_overview", markdown: "A" }])),
    });
    const mode = new DataForSeoAdapter({
      auth: "x",
      surface: "ai-mode",
      fetchImpl: fakeFetch(payload([{ type: "ai_overview", markdown: "A" }])),
    });

    expect((await overviews.execute("q")).serpDomains).toEqual(["a.com"]);
    expect((await mode.execute("q")).serpDomains).toBeUndefined();
  });
});
