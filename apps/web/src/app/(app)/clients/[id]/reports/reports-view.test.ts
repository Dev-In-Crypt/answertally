import { describe, expect, it } from "vitest";
import { proposalProblem, type ProposalValues } from "./reports-view";

const ok: ProposalValues = { retainer: 3500, effortMin: 8, effortMax: 12, hourlyCost: 85 };

describe("proposalProblem", () => {
  const cases: [string, Partial<ProposalValues>, RegExp | null][] = [
    ["валидная форма", {}, null],
    ["дробные часы и ставка допустимы", { effortMin: 7.5, hourlyCost: 85.5 }, null],
    ["пустое поле (Number('') = 0)", { hourlyCost: 0 }, /Fill in every field/],
    ["NaN", { effortMax: Number.NaN }, /Fill in every field/],
    ["дробный ретейнер", { retainer: 2500.5 }, /whole dollars/],
    ["ретейнер выше потолка схемы", { retainer: 1_000_001 }, /at most \$1,000,000/],
    ["часы выше потолка", { effortMax: 1001 }, /at most 1,000 hours/],
    ["ставка выше потолка", { hourlyCost: 10_001 }, /at most \$10,000/],
    ["перевёрнутый диапазон", { effortMin: 20, effortMax: 10 }, /inverted/],
  ];

  it.each(cases)("%s", (_name, patch, expected) => {
    const problem = proposalProblem({ ...ok, ...patch });
    if (expected === null) expect(problem).toBeNull();
    else expect(problem).toMatch(expected);
  });
});
