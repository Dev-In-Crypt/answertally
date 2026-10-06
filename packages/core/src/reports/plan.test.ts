import { describe, expect, it } from "vitest";
import {
  PLAN_MAX_TASKS_PER_PHASE,
  buildNinetyDayPlan,
  expectedSignalFor,
  type PlanInput,
} from "./plan";
import { ACTION_TYPES } from "../diagnosis/recommendations";

/**
 * Verify: план на 90 дней собирается из найденного, а не сочиняется.
 *
 * Проверяется главное: без возможностей плана нет вовсе, каждая задача несёт
 * причину, а третий месяц не выдумывает работу — он проверяет первые два.
 */

function task(overrides: Partial<PlanInput> = {}): PlanInput {
  return {
    title: "Refresh the pricing page",
    reason: "The page is cited in 26% of answers but does not name the brand.",
    actionType: "refresh_page",
    affectedPrompts: 4,
    evidence: "high",
    expectedSignal: expectedSignalFor("refresh_page"),
    ...overrides,
  };
}

describe("buildNinetyDayPlan", () => {
  it("без находок не выдаёт плана вовсе", () => {
    // Пустой план честнее универсального: обещать работу, для которой нет
    // оснований, — ровно то, за что агентству платить не станут.
    expect(buildNinetyDayPlan([])).toEqual([]);
  });

  it("одна и та же работа из разных возможностей — одна задача", () => {
    const outreach = { actionType: "source_outreach" as const, title: "Get the client covered on nytimes.com" };
    const plan = buildNinetyDayPlan([task(outreach), task(outreach), task(outreach)]);
    const expansion = plan.find((phase) => phase.key === "expansion");
    expect(expansion?.tasks).toHaveLength(1);
  });

  it("сначала то, что клиент контролирует сам, потом чужие площадки", () => {
    const plan = buildNinetyDayPlan([
      task({ actionType: "pr_editorial", title: "Get covered in the category roundup" }),
      task({ actionType: "refresh_page", title: "Refresh the comparison page" }),
    ]);

    expect(plan[0]?.title).toContain("Month 1");
    expect(plan[0]?.tasks[0]?.title).toBe("Refresh the comparison page");
    expect(plan[1]?.title).toContain("Month 2");
    expect(plan[1]?.tasks[0]?.title).toBe("Get covered in the category roundup");
  });

  it("третий месяц проверяет сделанное, а не добавляет новых работ", () => {
    const plan = buildNinetyDayPlan([task(), task({ actionType: "review_platform" })]);
    const validation = plan.at(-1);

    expect(validation?.title).toContain("Month 3");
    expect(validation?.tasks).toHaveLength(1);
    expect(validation?.tasks[0]?.reason).toContain("comparison group");
  });

  it("не кладёт в один месяц больше, чем можно сделать", () => {
    const many = Array.from({ length: 12 }, (_, index) => task({ title: `Task ${index}` }));
    const plan = buildNinetyDayPlan(many);

    expect(plan[0]?.tasks.length).toBe(PLAN_MAX_TASKS_PER_PHASE);
  });

  it("каждая задача объясняет себя и называет ожидаемый сигнал", () => {
    const plan = buildNinetyDayPlan([task(), task({ actionType: "source_outreach" })]);

    for (const phase of plan) {
      for (const item of phase.tasks) {
        expect(item.reason.trim().length).toBeGreaterThan(0);
        expect(item.expectedSignal.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it.each(ACTION_TYPES)("для типа %s есть описание ожидаемого сигнала", (actionType) => {
    // Иначе задача попадала бы в план без ответа на вопрос «как мы поймём,
    // что что-то произошло».
    expect(expectedSignalFor(actionType).length).toBeGreaterThan(0);
  });

  it("ни один сигнал не обещает результата", () => {
    for (const actionType of ACTION_TYPES) {
      expect(expectedSignalFor(actionType)).not.toMatch(/proof|proven|guarantee|caused|will incre/i);
    }
  });
});
