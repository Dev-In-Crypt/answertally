import { describe, expect, it } from "vitest";
import {
  billingPeriod,
  billingPeriodBounds,
  CHECKS_PER_CLIENT_MONTH,
  PLAN_LIMITS,
  usageStatus,
} from "./period";
import { ANSWER_PRICES, checkWeight } from "../adapters/pricing";
import { PLATFORM_IDS } from "../adapters/types";

describe("billingPeriod", () => {
  const cases: [string, string][] = [
    ["2026-08-11T18:00:00Z", "2026-08"],
    ["2026-01-01T00:00:00Z", "2026-01"],
    ["2026-12-31T23:59:59Z", "2026-12"],
  ];

  it.each(cases)("%s -> %s", (input, expected) => {
    expect(billingPeriod(new Date(input))).toBe(expected);
  });

  it("считается в UTC, а не в локальной зоне", () => {
    // 31 декабря 23:00 UTC — всё ещё декабрь, хотя в UTC+2 уже январь.
    expect(billingPeriod(new Date("2026-12-31T23:00:00Z"))).toBe("2026-12");
  });
});

describe("billingPeriodBounds", () => {
  it("возвращает полуинтервал [начало, конец)", () => {
    const { start, end } = billingPeriodBounds("2026-08");
    expect(start.toISOString()).toBe("2026-08-01T00:00:00.000Z");
    expect(end.toISOString()).toBe("2026-09-01T00:00:00.000Z");
  });

  it("переходит через год", () => {
    expect(billingPeriodBounds("2026-12").end.toISOString()).toBe("2027-01-01T00:00:00.000Z");
  });

  it("отвергает мусор, а не молча считает не тот период", () => {
    expect(() => billingPeriodBounds("2026-13")).toThrow(/Month must be/);
    expect(() => billingPeriodBounds("august")).toThrow(/Expected YYYY-MM/);
  });
});

describe("usageStatus", () => {
  it("считает долю израсходованного", () => {
    expect(usageStatus(500, 1000).ratio).toBe(0.5);
    expect(usageStatus(500, 1000).overAllowance).toBe(false);
  });

  it("превышение — это overage, а не ошибка: измерение не должно останавливаться", () => {
    const status = usageStatus(1500, 1000);
    expect(status.overAllowance).toBe(true);
    expect(status.ratio).toBe(1.5);
  });

  it("нулевой лимит не делит на ноль", () => {
    expect(usageStatus(10, 0).ratio).toBe(0);
  });
});

describe("PLAN_LIMITS", () => {
  it("соответствуют спеку: 3/10/25 клиентов", () => {
    expect(PLAN_LIMITS.starter.clientLimit).toBe(3);
    expect(PLAN_LIMITS.growth.clientLimit).toBe(10);
    expect(PLAN_LIMITS.scale.clientLimit).toBe(25);
  });

  it("allowance покрывает обычную работу с запасом, но не втрое", () => {
    /**
     * Обещать больше, чем продукт потребляет, — значит продать себе убыток:
     * клиент вправе забрать обещанное. Обещать меньше — значит держать
     * обычного покупателя в красной зоне весь месяц.
     *
     * Нижняя граница ненадолго опускалась до 1.1, чтобы в коридор влез
     * лимит Scale в 26 000, — то есть правило правилось под число. С
     * 28 500 запас снова 1.22, и правило вернулось на место. Проверить
     * стоило: при 26 000 типичное агентство на Scale расходовало 90%
     * лимита каждый месяц, ничего не нарушая.
     */
    for (const plan of [PLAN_LIMITS.starter, PLAN_LIMITS.growth, PLAN_LIMITS.scale]) {
      // С 08.10.2026 (цены вдвое ниже) лимит гарантирует умолчание — замер раз
      // в две недели у всех клиентов; еженедельно влезают Starter и Growth.
      const typical = (plan.clientLimit * CHECKS_PER_CLIENT_MONTH) / 2;
      expect(plan.aiCheckAllowance / typical).toBeGreaterThan(1.2);

      /**
       * Верхняя граница теперь в деньгах, а не в «не больше 1.6× обычного»:
       * с весами (Grok 5, Claude 4) запас нужен под включённые дорогие
       * ассистенты. Даже если весь лимит уйдёт на самый невыгодный для нас
       * ассистент, расход не превысит половины цены тарифа (решение фаундера
       * 08.10.2026 при снижении цен; раньше была треть).
       */
      const worstCost = Math.max(
        ...PLATFORM_IDS.map((id) => (plan.aiCheckAllowance / checkWeight(id)) * ANSWER_PRICES[id].usd),
      );
      expect(worstCost).toBeLessThan(plan.priceUsd / 2);
    }
  });

  it("цена растёт медленнее лимита клиентов — так и задумано в спеке", () => {
    const starterPerClient = PLAN_LIMITS.starter.priceUsd / PLAN_LIMITS.starter.clientLimit;
    const scalePerClient = PLAN_LIMITS.scale.priceUsd / PLAN_LIMITS.scale.clientLimit;
    expect(scalePerClient).toBeLessThan(starterPerClient);
  });
});
