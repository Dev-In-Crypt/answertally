import { describe, expect, it } from "vitest";
import { classifyReferrer, summariseTraffic } from "./referrers";
import { parseTrafficCsv } from "./import";
import { UnconnectedAnalyticsProvider, createAnalyticsProvider } from "./provider";

/**
 * Verify T97: переход засчитывается ассистенту только по известному хосту,
 * непонятные источники не пропадают молча, а без доступов продукт не
 * притворяется, что читает аналитику сам.
 */

describe("classifyReferrer", () => {
  it("узнаёт ассистентов по хосту, включая ссылку целиком", () => {
    expect(classifyReferrer("chatgpt.com")).toBe("chatgpt");
    expect(classifyReferrer("https://www.perplexity.ai/search?q=x")).toBe("perplexity");
    expect(classifyReferrer("gemini.google.com")).toBe("gemini");
  });

  it("чужой домен не становится ассистентом", () => {
    // Подстрока «ai» есть, ассистентом сайт от этого не становится.
    expect(classifyReferrer("mail.ru")).toBeNull();
    expect(classifyReferrer("aihelp.example.com")).toBeNull();
    expect(classifyReferrer("")).toBeNull();
  });
});

describe("parseTrafficCsv", () => {
  const HEADER = "date,source,sessions";

  it("разбирает выгрузку и складывает строки одного дня", () => {
    const result = parseTrafficCsv(
      [HEADER, "2026-08-01,chatgpt.com,12", "20260801,chat.openai.com,3"].join("\n"),
    );

    expect(result.errors).toEqual([]);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ assistant: "chatgpt", sessions: 15 });
  });

  it("непонятный источник не отбрасывается молча", () => {
    const result = parseTrafficCsv([HEADER, "2026-08-01,google,400"].join("\n"));

    expect(result.rows).toEqual([]);
    expect(result.skippedReferrers).toEqual(["google"]);
  });

  it("кривые строки называются по номерам", () => {
    const result = parseTrafficCsv(
      [HEADER, "not-a-date,chatgpt.com,5", "2026-08-01,chatgpt.com,many"].join("\n"),
    );

    expect(result.errors).toHaveLength(2);
    expect(result.errors[0]).toContain("Line 2");
    expect(result.errors[1]).toContain("Line 3");
  });

  it("файл без заголовка объясняет, что нужно", () => {
    expect(parseTrafficCsv("2026-08-01,chatgpt.com,5").errors[0]).toContain("date, source, sessions");
  });

  it("пустой файл — это ошибка, а не ноль сессий", () => {
    expect(parseTrafficCsv("").rows).toEqual([]);
    expect(parseTrafficCsv("").errors).toHaveLength(1);
  });

  it("выгрузка GA4 как есть: шапка «#…», пустые строки, «Session source / medium»", () => {
    const ga4 = [
      "# ----------------------------------------",
      "# Traffic acquisition: Session source / medium",
      "# Start date: 20260801",
      "# ----------------------------------------",
      "",
      "Date,Session source / medium,Sessions,Engaged sessions",
      "20260801,chatgpt.com / referral,7,5",
      "20260801,google / organic,300,200",
    ].join("\n");
    const result = parseTrafficCsv(ga4);

    expect(result.errors).toEqual([]);
    expect(result.rows[0]).toMatchObject({ assistant: "chatgpt", sessions: 7 });
    expect(result.skippedReferrers).toEqual(["google"]);
  });

  it("без колонки даты отказ показывает прочитанную первую строку", () => {
    const error = parseTrafficCsv("Session source,Sessions\nchatgpt.com,5").errors[0];
    expect(error).toContain("Date as a dimension");
    expect(error).toContain("Session source, Sessions");
  });
});

describe("summariseTraffic", () => {
  const from = new Date("2026-07-16T00:00:00.000Z");
  const to = new Date("2026-08-13T00:00:00.000Z");

  it("складывает по ассистентам и считает доли", () => {
    const summary = summariseTraffic(
      [
        { day: new Date("2026-08-01T00:00:00.000Z"), assistant: "chatgpt", sessions: 30 },
        { day: new Date("2026-08-02T00:00:00.000Z"), assistant: "chatgpt", sessions: 10 },
        { day: new Date("2026-08-02T00:00:00.000Z"), assistant: "perplexity", sessions: 10 },
      ],
      from,
      to,
    );

    expect(summary.totalSessions).toBe(50);
    expect(summary.byAssistant[0]).toEqual({ assistant: "chatgpt", sessions: 40, sharePct: 80 });
  });

  it("дни вне окна не учитываются", () => {
    const summary = summariseTraffic(
      [{ day: new Date("2026-05-01T00:00:00.000Z"), assistant: "chatgpt", sessions: 30 }],
      from,
      to,
    );

    expect(summary.totalSessions).toBe(0);
  });
});

describe("createAnalyticsProvider", () => {
  it("без доступов продукт не притворяется, что читает аналитику", async () => {
    const provider = createAnalyticsProvider({});

    expect(provider).toBeInstanceOf(UnconnectedAnalyticsProvider);
    expect(provider.configured).toBe(false);
    await expect(provider.fetchTraffic({} as never)).rejects.toThrow(/Import a traffic export/);
  });

  it("заданные доступы без реализации — понятная ошибка, а не тихий импорт", () => {
    expect(() => createAnalyticsProvider({ GA4_CREDENTIALS_JSON: "{}" })).toThrow(/not implemented/);
  });
});
