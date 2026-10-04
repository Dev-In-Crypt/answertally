import { describe, expect, it } from "vitest";
import { PLAN_LIMITS } from "./period";
import {
  FREE_CHECK_ALLOWANCE,
  PAST_DUE_GRACE_DAYS,
  canAddClient,
  canStartMeasurement,
  canSwitchToPlan,
  entitlementsFor,
  type SubscriptionSnapshot,
} from "./entitlements";

/**
 * Verify T86: права считаются от подписки, а сбой платежа не выключает
 * продукт в тот же час — но и не длится вечно.
 */

const NOW = new Date("2026-09-15T12:00:00.000Z");

function snapshot(patch: Partial<SubscriptionSnapshot> = {}): SubscriptionSnapshot {
  return {
    plan: "growth",
    status: "active",
    currentPeriodEnd: new Date("2026-10-01T00:00:00.000Z"),
    cancelAtPeriodEnd: false,
    ...patch,
  };
}

describe("entitlementsFor", () => {
  it("без подписки работают лимиты starter", () => {
    const result = entitlementsFor(null, NOW);

    expect(result.plan).toBe("starter");
    expect(result.clientLimit).toBe(PLAN_LIMITS.starter.clientLimit);
    expect(result.active).toBe(true);
  });

  it("активная подписка даёт лимиты своего плана", () => {
    const result = entitlementsFor(snapshot(), NOW);

    expect(result.plan).toBe("growth");
    expect(result.clientLimit).toBe(PLAN_LIMITS.growth.clientLimit);
    expect(result.aiCheckAllowance).toBe(PLAN_LIMITS.growth.aiCheckAllowance);
    expect(result.active).toBe(true);
  });

  it("пробный период — это работающий продукт", () => {
    expect(entitlementsFor(snapshot({ status: "trialing" }), NOW).active).toBe(true);
  });

  it("отмена в конце периода не выключает продукт сейчас", () => {
    const result = entitlementsFor(snapshot({ cancelAtPeriodEnd: true }), NOW);

    expect(result.active).toBe(true);
    expect(result.reason).toMatch(/ends at the close/i);
  });

  it("отменённая к концу периода подписка закрывается по дате, даже без вебхука", () => {
    const periodEnd = new Date("2026-09-10T00:00:00.000Z");
    const ended = entitlementsFor(
      snapshot({ cancelAtPeriodEnd: true, currentPeriodEnd: periodEnd }),
      NOW,
    );
    expect(ended.active).toBe(false);
    expect(ended.paying).toBe(false);

    // В пределах суток после конца периода — ещё ждём событие провайдера.
    const justEnded = entitlementsFor(
      snapshot({ cancelAtPeriodEnd: true, currentPeriodEnd: new Date("2026-09-15T00:00:00.000Z") }),
      NOW,
    );
    expect(justEnded.active).toBe(true);
  });

  it("непрошедший платёж оставляет доступ на время отсрочки", () => {
    const periodEnd = new Date("2026-09-10T00:00:00.000Z");
    const result = entitlementsFor(
      snapshot({ status: "past_due", currentPeriodEnd: periodEnd }),
      NOW,
    );

    expect(result.active).toBe(true);
    expect(result.plan).toBe("growth");
  });

  it("после отсрочки доступ закрывается", () => {
    const periodEnd = new Date("2026-09-10T00:00:00.000Z");
    const afterGrace = new Date(periodEnd.getTime() + (PAST_DUE_GRACE_DAYS + 1) * 86_400_000);

    const result = entitlementsFor(
      snapshot({ status: "past_due", currentPeriodEnd: periodEnd }),
      afterGrace,
    );

    expect(result.active).toBe(false);
  });

  it("непрошедший платёж без оплаченного периода не даёт бессрочной отсрочки", () => {
    // Строка без срока заводится завершённым checkout: тариф и период
    // приезжают следующим событием. Если оно потерялось, а списание не
    // прошло, отсрочке не от чего считаться — и это не повод работать
    // бесплатно и бессрочно.
    const result = entitlementsFor(snapshot({ status: "past_due", currentPeriodEnd: null }), NOW);

    expect(result.active).toBe(false);
    expect(result.reason).toMatch(/no paid period/i);
  });

  it("отменённая подписка возвращает к starter и закрывает работу", () => {
    const result = entitlementsFor(snapshot({ status: "canceled" }), NOW);

    expect(result.plan).toBe("starter");
    expect(result.active).toBe(false);
    expect(result.reason).toMatch(/cancelled/i);
  });

  it("незавершённая оплата не даёт доступа", () => {
    expect(entitlementsFor(snapshot({ status: "incomplete" }), NOW).active).toBe(false);
  });
});

describe("canAddClient", () => {
  it("до лимита клиента завести можно", () => {
    const decision = canAddClient(entitlementsFor(null, NOW), 2);
    expect(decision.allowed).toBe(true);
  });

  it("на лимите отказ объясняет, что делать", () => {
    const decision = canAddClient(entitlementsFor(null, NOW), PLAN_LIMITS.starter.clientLimit);

    expect(decision.allowed).toBe(false);
    expect(decision.message).toContain("Starter");
    expect(decision.message).toMatch(/upgrade/i);
  });

  it("выключенный аккаунт клиентов не заводит", () => {
    const decision = canAddClient(entitlementsFor(snapshot({ status: "canceled" }), NOW), 0);

    expect(decision.allowed).toBe(false);
    expect(decision.message).toMatch(/cancelled/i);
  });
});

describe("canSwitchToPlan", () => {
  const starter = { plan: "starter" as const, clientLimit: PLAN_LIMITS.starter.clientLimit };

  it("понижение в пределах нового лимита проходит", () => {
    expect(canSwitchToPlan(starter, PLAN_LIMITS.starter.clientLimit).allowed).toBe(true);
  });

  it("понижение ниже числа заведённых клиентов не проходит", () => {
    // Иначе агентство платит за трёх, а меряется пятеро: отключить чужих
    // клиентов за него мы не можем, а мерить больше купленного не будем.
    const decision = canSwitchToPlan(starter, PLAN_LIMITS.starter.clientLimit + 2);

    expect(decision.allowed).toBe(false);
    expect(decision.message).toContain("Starter");
  });

  it("отказ называет, скольких убрать", () => {
    // «Уберите лишних» без числа — задача без условия.
    const decision = canSwitchToPlan(starter, PLAN_LIMITS.starter.clientLimit + 2);
    expect(decision.message).toContain("Archive 2 clients");

    const one = canSwitchToPlan(starter, PLAN_LIMITS.starter.clientLimit + 1);
    expect(one.message).toContain("Archive 1 client");
  });

  it("повышение не блокируется числом клиентов", () => {
    const decision = canSwitchToPlan(
      { plan: "scale", clientLimit: PLAN_LIMITS.scale.clientLimit },
      PLAN_LIMITS.growth.clientLimit,
    );
    expect(decision.allowed).toBe(true);
  });
});

describe("canStartMeasurement", () => {
  const free = entitlementsFor(null, NOW);
  const paid = entitlementsFor(snapshot(), NOW);

  it("бесплатному расписание не запускает ничего, даже при нетронутом лимите", () => {
    // Измерение по расписанию — платная часть. Иначе брошенный аккаунт с
    // сохранённым расписанием тратил бы наши деньги, не появляясь.
    const decision = canStartMeasurement(free, 0, 0, { trigger: "scheduled" });
    expect(decision.allowed).toBe(false);
    expect(decision.message).toMatch(/free audit/i);
  });

  it("плательщику расписание запускается как раньше", () => {
    expect(canStartMeasurement(paid, 0, 0, { trigger: "scheduled" }).allowed).toBe(true);
  });

  it("пока идёт прогон, бесплатному второй не стартует", () => {
    /**
     * Проверки списываются, когда ответ записан, а решение — при старте.
     * Три «Run now» подряд на трёх клиентах видели бы «использовано 0» и
     * уходили бы три аудита вместо одного.
     */
    const decision = canStartMeasurement(free, 0, 144, { trigger: "manual", runsInFlight: 1 });
    expect(decision.allowed).toBe(false);
    expect(decision.message).toMatch(/still running/i);
  });

  it("плательщика идущие прогоны не останавливают", () => {
    expect(canStartMeasurement(paid, 0, 144, { trigger: "manual", runsInFlight: 3 }).allowed).toBe(
      true,
    );
  });

  it("до первой оплаты бесплатные проверки кончаются", () => {
    // Без этой границы незаплативший измерял бы бесконечно: месячный лимит
    // тарифа нигде не проверялся, он только показывался на экране.
    expect(canStartMeasurement(free, 0).allowed).toBe(true);
    expect(canStartMeasurement(free, FREE_CHECK_ALLOWANCE - 1).allowed).toBe(true);

    const spent = canStartMeasurement(free, FREE_CHECK_ALLOWANCE);
    expect(spent.allowed).toBe(false);
    expect(spent.message).toMatch(/plan/i);
  });

  it("прогон, который не помещается в остаток, не начинается", () => {
    // Наполовину сделанный прогон — это доля по неполной выборке, то есть
    // цифра, по которой нельзя принимать решение (контракт C3).
    const decision = canStartMeasurement(free, FREE_CHECK_ALLOWANCE - 10, 216);

    expect(decision.allowed).toBe(false);
    expect(decision.message).toContain("216");
    expect(decision.message).toContain("10");
  });

  it("плательщик упирается ровно в месячный лимит тарифа", () => {
    // Раньше лимит только показывался, и тариф за $499 мог сжечь на
    // ответах десятки тысяч в месяц. Потолок — 100%, решение фаундера.
    const allowance = paid.aiCheckAllowance;
    expect(canStartMeasurement(paid, allowance - 216, 216).allowed).toBe(true);

    const over = canStartMeasurement(paid, allowance - 215, 216);
    expect(over.allowed).toBe(false);
    expect(over.message).toContain("216");

    const spent = canStartMeasurement(paid, allowance, 1);
    expect(spent.allowed).toBe(false);
    expect(spent.message).toMatch(/used up/i);
  });

  it("просрочка в пределах отсрочки — это ещё плательщик", () => {
    const pastDue = entitlementsFor(
      snapshot({ status: "past_due", currentPeriodEnd: new Date("2026-09-14T00:00:00.000Z") }),
      NOW,
    );

    expect(pastDue.paying).toBe(true);
    expect(canStartMeasurement(pastDue, 0, 144).allowed).toBe(true);
  });

  it("выключенный аккаунт не измеряет вовсе", () => {
    const cancelled = entitlementsFor(snapshot({ status: "canceled" }), NOW);
    const decision = canStartMeasurement(cancelled, 0);

    expect(decision.allowed).toBe(false);
    expect(decision.message).toMatch(/cancelled/i);
  });
});
