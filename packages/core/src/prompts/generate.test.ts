import { describe, expect, it } from "vitest";
import {
  buildPromptCandidates,
  clampPromptCount,
  DEFAULT_GENERATED_PROMPT_COUNT,
  GENERATED_PROMPT_RANGE,
  generatePromptsFromTemplates,
  TemplatePromptGenerator,
  type PromptSeed,
} from "./generate";

const SEED: PromptSeed = {
  domain: "acmecrm.test",
  industry: "CRM software",
  brandNames: ["AcmeCRM", "Acme"],
  competitorNames: ["HubSpot", "Pipedrive", "Close"],
};

describe("generatePromptsFromTemplates", () => {
  it("даёт количество из допустимого диапазона", () => {
    const prompts = generatePromptsFromTemplates(SEED);
    expect(prompts.length).toBe(DEFAULT_GENERATED_PROMPT_COUNT);
    expect(prompts.length).toBeGreaterThanOrEqual(GENERATED_PROMPT_RANGE.min);
    expect(prompts.length).toBeLessThanOrEqual(GENERATED_PROMPT_RANGE.max);
  });

  it("даже минимальный набор покрывает все намерения", () => {
    const prompts = generatePromptsFromTemplates(SEED, GENERATED_PROMPT_RANGE.min);
    const intents = new Set(prompts.map((prompt) => prompt.intent));

    expect(prompts).toHaveLength(GENERATED_PROMPT_RANGE.min);
    expect([...intents].sort()).toEqual(["comparison", "learning", "other", "purchase"]);
  });

  it("детерминирован: одинаковый вход — одинаковый выход", () => {
    expect(generatePromptsFromTemplates(SEED)).toEqual(generatePromptsFromTemplates(SEED));
  });

  it("не повторяет промпты", () => {
    const texts = generatePromptsFromTemplates(SEED, 30).map((prompt) => prompt.text);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it("сравнивает клиента с каждым конкурентом", () => {
    const texts = buildPromptCandidates(SEED).map((prompt) => prompt.text);

    for (const competitor of SEED.competitorNames) {
      expect(texts).toContain(`AcmeCRM vs ${competitor}`);
      expect(texts).toContain(`alternatives to ${competitor}`);
    }
  });

  it("контрольные промпты не упоминают ни клиента, ни конкурентов", () => {
    const controls = buildPromptCandidates(SEED).filter((prompt) => prompt.isControl);

    expect(controls.length).toBeGreaterThan(0);
    for (const control of controls) {
      expect(control.text.toLowerCase()).not.toContain("acme");
      for (const competitor of SEED.competitorNames) {
        expect(control.text.toLowerCase()).not.toContain(competitor.toLowerCase());
      }
    }
  });

  it("контрольная группа есть и в обрезанном наборе — без неё эксперимент не с чем сравнивать", () => {
    const prompts = generatePromptsFromTemplates(SEED, GENERATED_PROMPT_RANGE.min);
    expect(prompts.some((prompt) => prompt.isControl)).toBe(true);
  });

  it("работает без конкурентов", () => {
    const prompts = generatePromptsFromTemplates({ ...SEED, competitorNames: [] });

    expect(prompts.length).toBeGreaterThanOrEqual(GENERATED_PROMPT_RANGE.min);
    expect(prompts.every((prompt) => !prompt.text.includes("vs "))).toBe(true);
  });

  it("пустая индустрия не даёт промптов с дырой — берётся домен", () => {
    const prompts = generatePromptsFromTemplates({ ...SEED, industry: "   " });

    expect(prompts.every((prompt) => prompt.text.trim().length > 0)).toBe(true);
    expect(prompts.some((prompt) => prompt.text.includes("acmecrm"))).toBe(true);
  });

  it("пустые имена конкурентов отбрасываются, а не превращаются в «vs »", () => {
    const prompts = buildPromptCandidates({ ...SEED, competitorNames: ["", "  ", "HubSpot"] });
    const versus = prompts.filter((prompt) => prompt.text.includes(" vs "));

    expect(versus).toHaveLength(1);
    expect(versus[0]?.text).toBe("AcmeCRM vs HubSpot");
  });

  it("каждому промпту назначен кластер", () => {
    for (const prompt of generatePromptsFromTemplates(SEED, 30)) {
      expect(prompt.cluster.length).toBeGreaterThan(0);
    }
  });
});

describe("clampPromptCount", () => {
  const cases: Array<[number, number]> = [
    [1, 12],
    [12, 12],
    [20, 20],
    [24, 24],
    [30, 30],
    [100, 30],
  ];

  for (const [input, expected] of cases) {
    it(`${input} → ${expected}`, () => {
      expect(clampPromptCount(input)).toBe(expected);
    });
  }
});

describe("TemplatePromptGenerator", () => {
  it("реализует интерфейс генератора", async () => {
    const generated = await new TemplatePromptGenerator().generate(SEED, 22);
    expect(generated).toHaveLength(22);
    expect(generated).toEqual(generatePromptsFromTemplates(SEED, 22));
  });
});
