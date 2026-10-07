import { describe, expect, it } from "vitest";
import { ASSISTANTS } from "./catalogue";
import { MockAdapter, stableHash } from "./mock";
import {
  getAdapter,
  getAdapters,
  isPlatform,
  parseAdaptersMode,
  registerLiveAdapter,
} from "./registry";
import { adapterResultSchema, DEFAULT_PLATFORMS, PLATFORMS } from "./types";
import type { Platform, PlatformAdapter } from "./types";

/** Verify T12. */

describe("stableHash", () => {
  it("детерминирован", () => {
    expect(stableHash("best CRM for startups")).toBe(stableHash("best CRM for startups"));
  });

  it("различает разные строки", () => {
    expect(stableHash("a")).not.toBe(stableHash("b"));
  });
});

describe("MockAdapter", () => {
  it.each([...PLATFORMS])("%s возвращает валидный AdapterResult", async (platform) => {
    const result = await new MockAdapter(platform).execute("some unseen prompt");
    expect(() => adapterResultSchema.parse(result)).not.toThrow();
  });

  it("один и тот же промпт всегда даёт один и тот же ответ", async () => {
    const adapter = new MockAdapter("chatgpt");
    const first = await adapter.execute("an unseen prompt about CRMs");
    const second = await adapter.execute("an unseen prompt about CRMs");
    const third = await new MockAdapter("chatgpt").execute("an unseen prompt about CRMs");

    expect(second).toEqual(first);
    expect(third).toEqual(first);
  });

  it("точное совпадение промпта важнее хэша", async () => {
    const result = await new MockAdapter("chatgpt").execute("best CRM for startups");
    expect(result.text).toContain("AcmeCRM");
    expect(result.citations.length).toBeGreaterThan(0);
  });

  it("совпадение промпта нечувствительно к регистру и пробелам", async () => {
    const adapter = new MockAdapter("perplexity");
    const canonical = await adapter.execute("best CRM for startups");
    const messy = await adapter.execute("  Best CRM For Startups  ");
    expect(messy).toEqual(canonical);
  });

  it("ответы платформ различаются — visibility нельзя считать по одной платформе", async () => {
    const chatgpt = await new MockAdapter("chatgpt").execute("best CRM for startups");
    const gemini = await new MockAdapter("gemini").execute("best CRM for startups");

    expect(chatgpt.modelVersion).not.toBe(gemini.modelVersion);
    expect(chatgpt.text).not.toBe(gemini.text);
  });

  it("неизвестные промпты распределяются, а не липнут к одному ответу", async () => {
    const adapter = new MockAdapter("chatgpt");
    const texts = new Set<string>();
    for (let i = 0; i < 30; i++) {
      texts.add((await adapter.execute(`unseen prompt number ${i}`)).text);
    }
    expect(texts.size).toBeGreaterThan(1);
  });
});

describe("parseAdaptersMode", () => {
  it("по умолчанию mock — случайный выход в сеть невозможен", () => {
    expect(parseAdaptersMode(undefined)).toBe("mock");
    expect(parseAdaptersMode("")).toBe("mock");
  });

  it("распознаёт явные режимы", () => {
    expect(parseAdaptersMode("mock")).toBe("mock");
    expect(parseAdaptersMode("live")).toBe("live");
  });

  it("падает на мусоре, а не молча уходит в дефолт", () => {
    expect(() => parseAdaptersMode("LIVE")).toThrow(/Invalid ADAPTERS_MODE/);
    expect(() => parseAdaptersMode("production")).toThrow(/Invalid ADAPTERS_MODE/);
  });
});

describe("registry", () => {
  it("в mock-режиме отдаёт MockAdapter для всех платформ", () => {
    for (const platform of PLATFORMS) {
      expect(getAdapter(platform, "mock")).toBeInstanceOf(MockAdapter);
    }
  });

  it("getAdapters сохраняет порядок платформ", () => {
    const adapters = getAdapters(["gemini", "chatgpt"], "mock");
    expect(adapters.map((a) => a.platform)).toEqual(["gemini", "chatgpt"]);
  });

  it("live без зарегистрированного адаптера даёт понятную ошибку", () => {
    expect(() => getAdapter("perplexity", "live")).toThrow(/No live adapter registered/);
  });

  it("зарегистрированный live-адаптер используется", () => {
    const fake: PlatformAdapter = {
      platform: "chatgpt",
      execute: () =>
        Promise.resolve({
          text: "live",
          citations: [],
          modelVersion: "live-model",
          costUsd: 1,
          latencyMs: 1,
        }),
    };
    registerLiveAdapter("chatgpt", () => fake);
    expect(getAdapter("chatgpt", "live")).toBe(fake);
  });

  it("isPlatform отсекает неизвестные платформы", () => {
    expect(isPlatform("chatgpt")).toBe(true);
    expect(isPlatform("claude")).toBe(true);
    expect(isPlatform("grok")).toBe(true);
    // У Copilot нет публичного API: платформой он не является.
    expect(isPlatform("copilot")).toBe(false);
    const unknown: string = "bing";
    expect(isPlatform(unknown)).toBe(false);
  });
});

describe("контракт адаптера", () => {
  it("MockAdapter удовлетворяет интерфейсу PlatformAdapter", () => {
    const platform: Platform = "gemini";
    const adapter: PlatformAdapter = new MockAdapter(platform);
    expect(adapter.platform).toBe(platform);
    expect(typeof adapter.execute).toBe("function");
  });
});

describe("набор по умолчанию", () => {
  it("ChatGPT, Perplexity и AI Overviews, и входит в полный набор", () => {
    // 07.10.2026: Grok вышел из умолчания (самый дорогой, весит 5 проверок),
    // AI Overviews вошёл.
    expect([...DEFAULT_PLATFORMS]).toEqual(["chatgpt", "perplexity", "ai-overviews"]);
    for (const platform of DEFAULT_PLATFORMS) {
      expect(PLATFORMS).toContain(platform);
    }
  });

  it("умолчание не предлагает того, кого мы не измеряем", () => {
    // Gemini ушёл отсюда не из-за цены: его запрещают условия Google.
    // Заводить нового клиента с ассистентом, по которому не будет ни одного
    // ответа, — обещать измерение, которого не случится.
    for (const platform of DEFAULT_PLATFORMS) {
      expect(ASSISTANTS.find((a) => a.id === platform)?.measurable).toBe(true);
    }
    expect(DEFAULT_PLATFORMS).not.toContain("gemini");
  });

  it("дорогой ассистент сам не включается: он стоит денег, о которых не просили", () => {
    expect(DEFAULT_PLATFORMS).not.toContain("claude");
  });
});
