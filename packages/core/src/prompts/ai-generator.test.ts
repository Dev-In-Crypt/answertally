import { describe, expect, it } from "vitest";
import { AiPromptGenerator, buildInstructions, finalizeAiDraft } from "./ai-generator";

const SEED = {
  domain: "saucony.com",
  industry: "running shoes",
  brandNames: ["Saucony"],
  competitorNames: ["Brooks", "Hoka"],
};

describe("finalizeAiDraft", () => {
  it("держит набор пригодным к замеру, что бы ни вернула модель", () => {
    const draft = [
      { text: "best shoes for marathon training", intent: "comparison" as const },
      { text: "best shoes for marathon training", intent: "comparison" as const },
      { text: "Saucony vs Brooks for daily runs", intent: "comparison" as const },
      { text: "Saucony vs Hoka cushioning", intent: "comparison" as const },
      { text: "is Saucony good for flat feet", intent: "learning" as const },
      { text: "are Hoka shoes worth it", intent: "control" as const },
      { text: "how running shoe foam has changed", intent: "control" as const },
      { text: "x", intent: "learning" as const },
    ];
    const prompts = finalizeAiDraft(draft, SEED, 20);

    expect(prompts).toHaveLength(20);
    // Повторы и мусор отброшены.
    expect(prompts.filter((p) => p.text === "best shoes for marathon training")).toHaveLength(1);
    expect(prompts.some((p) => p.text === "x")).toBe(false);
    // Не больше двух вопросов с именем клиента: иначе бренд назван самим вопросом.
    expect(prompts.filter((p) => /saucony/i.test(p.text))).toHaveLength(2);
    // Контроль с брендом — уже не контроль.
    const hoka = prompts.find((p) => p.text === "are Hoka shoes worth it");
    expect(hoka?.isControl).toBe(false);
    // Контрольных хватает для сравнения в экспериментах.
    const controls = prompts.filter((p) => p.isControl);
    expect(controls.length).toBeGreaterThanOrEqual(3);
    expect(controls.every((p) => !/saucony|brooks|hoka/i.test(p.text))).toBe(true);
  });

  it("лишнее срезает, оставляя контрольные", () => {
    const draft = Array.from({ length: 40 }, (_, i) => ({
      text: `question number ${i} about trail shoes`,
      intent: i % 10 === 0 ? ("control" as const) : ("comparison" as const),
    }));
    const prompts = finalizeAiDraft(draft, SEED, 24);
    expect(prompts).toHaveLength(24);
    expect(prompts.filter((p) => p.isControl).length).toBeGreaterThanOrEqual(3);
  });
});

describe("AiPromptGenerator", () => {
  it("шлёт описание сайта и разбирает строгий JSON", async () => {
    let sent = "";
    const fetchImpl = (async (_url: string, init: RequestInit) => {
      sent = String(init.body);
      const output = {
        prompts: [
          { text: "best trail running shoes for beginners", intent: "comparison" },
          { text: "how running shoes are made", intent: "control" },
        ],
      };
      return new Response(JSON.stringify({ output_text: JSON.stringify(output) }), { status: 200 });
    }) as unknown as typeof fetch;

    const generator = new AiPromptGenerator({ apiKey: "test", model: "m", fetchImpl });
    const prompts = await generator.generate({ ...SEED, siteSummary: "Title: Saucony Running" }, 20);

    expect(sent).toContain("Saucony Running");
    expect(sent).not.toContain("web_search");
    expect(prompts[0]?.text).toBe("best trail running shoes for beginners");
    expect(prompts).toHaveLength(20);
  });

  it("инструкция запрещает называть клиента и требует контроль без брендов", () => {
    const text = buildInstructions({ ...SEED, siteSummary: null }, 24);
    expect(text).toContain("Do not name Saucony");
    expect(text).toContain("name no brand at all");
    expect(text).toContain("homepage could not be read");
  });
});
