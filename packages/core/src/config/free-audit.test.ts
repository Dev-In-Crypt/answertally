import { describe, expect, it } from "vitest";
import { ANSWER_PRICES } from "../adapters/pricing";
import { PLAN_LIMITS } from "../billing/period";
import type { PlanId } from "../billing/entitlements";
import { FREE_AUDIT_ASSISTANTS, capabilitiesFor, capabilitiesForAgency } from "./measurement";

/**
 * Что продукт спрашивает до первой оплаты.
 *
 * Бесплатный аудит — единственный расход без верхней границы: аккаунт
 * заводится на любой адрес, а лимит в 250 проверок считается на аккаунт.
 * Поэтому набор там уже, чем на самом младшем тарифе.
 */

const PLANS = Object.keys(PLAN_LIMITS) as PlanId[];

describe("capabilitiesForAgency", () => {
  it("плательщику даёт ровно то, что даёт его тариф", () => {
    for (const plan of PLANS) {
      expect(capabilitiesForAgency({ plan, paying: true })).toEqual(capabilitiesFor(plan));
    }
  });

  it("до первой оплаты набор уже и Grok в него не входит", () => {
    const free = capabilitiesForAgency({ plan: "starter", paying: false });

    expect(free.assistants).toEqual(FREE_AUDIT_ASSISTANTS);
    expect(free.assistants).not.toContain("grok");
    // Умолчание не может предлагать то, за что мы не готовы платить.
    expect(free.defaultAssistants).toEqual(free.assistants);
  });

  it("сужение не зависит от того, какой тариф записан у неплательщика", () => {
    /**
     * Подписки нет — тариф всегда starter по умолчанию. Но если он когда-то
     * окажется другим, набор обязан остаться бесплатным: платит или нет —
     * вот вопрос, на который здесь отвечают.
     */
    for (const plan of PLANS) {
      expect(capabilitiesForAgency({ plan, paying: false }).assistants).toEqual(
        FREE_AUDIT_ASSISTANTS,
      );
    }
  });

  it("бесплатный набор — подмножество младшего тарифа", () => {
    // Дать бесплатно больше, чем за деньги, значит сделать оплату бессмысленной.
    const starter = capabilitiesFor("starter").assistants;
    for (const id of FREE_AUDIT_ASSISTANTS) {
      expect(starter).toContain(id);
    }
  });
});

describe("почему набор именно такой", () => {
  it("каждый бесплатный ассистент дешевле любого исключённого", () => {
    /**
     * Список задан перечислением, а не отбором по цене: подешевей Grok
     * однажды — и бесплатный аудит изменился бы молча, хотя такого решения
     * никто не принимал.
     *
     * Но причина списка — цена, и она должна оставаться правдой. Этот тест
     * падает, когда разрыв исчезает, и зовёт пересмотреть список руками, а
     * не оставляет устаревшее решение жить само по себе.
     */
    const excluded = capabilitiesFor("starter").assistants.filter(
      (id) => !FREE_AUDIT_ASSISTANTS.includes(id),
    );

    expect(excluded.length).toBeGreaterThan(0);

    const dearestFree = Math.max(...FREE_AUDIT_ASSISTANTS.map((id) => ANSWER_PRICES[id].usd));
    const cheapestExcluded = Math.min(...excluded.map((id) => ANSWER_PRICES[id].usd));

    expect(dearestFree).toBeLessThan(cheapestExcluded);
  });

  it("исключение экономит заметно, а не копейки", () => {
    /**
     * Типовой аудит: 24 вопроса × 3 сэмпла. Если разница перестанет быть
     * кратной, ограничение не стоит того, что оно отнимает у витрины.
     */
    const rounds = 24 * 3;
    const cost = (ids: readonly string[]) =>
      rounds * ids.reduce((sum, id) => sum + ANSWER_PRICES[id as "grok"].usd, 0);

    const full = cost(capabilitiesFor("starter").assistants);
    const free = cost(FREE_AUDIT_ASSISTANTS);

    expect(free * 3).toBeLessThan(full);
  });
});
