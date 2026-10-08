import { describe, expect, it } from "vitest";
import {
  effectiveAccountPriceUsd,
  LIST_ACCOUNT_PRICE_USD,
  monthlyTotalUsd,
  REFERRAL_MONTHS,
  REFERRAL_RATE,
  VOLUME_ACCOUNT_PRICE_USD,
  VOLUME_DISCOUNT,
  VOLUME_THRESHOLD,
} from "./partner";
import { PLAN_LIMITS } from "./period";
import { entitlementsFor } from "./entitlements";

/**
 * Оптовая цена печатается на сайте, то есть становится обещанием.
 *
 * Проверяется не арифметика ради арифметики, а два свойства, которые нельзя
 * потерять при следующем пересмотре тарифов: добавленный клиент всегда
 * увеличивает наш доход, и скидка остаётся той, что объявлена.
 */

describe("оптовые условия", () => {
  it("порог и база берутся у тарифа, а не вписаны отдельно", () => {
    expect(VOLUME_THRESHOLD).toBe(PLAN_LIMITS.scale.clientLimit);
    expect(LIST_ACCOUNT_PRICE_USD).toBe(
      Math.round(PLAN_LIMITS.scale.priceUsd / PLAN_LIMITS.scale.clientLimit),
    );
  });

  it("скидка на аккаунт сверх порога — ровно объявленная", () => {
    expect(VOLUME_DISCOUNT).toBe(0.2);
    expect(VOLUME_ACCOUNT_PRICE_USD).toBe(38);
    // Округление до доллара: $48 → $38 — это 20.8%, а не ровно 20%.
    expect(1 - VOLUME_ACCOUNT_PRICE_USD / LIST_ACCOUNT_PRICE_USD).toBeCloseTo(VOLUME_DISCOUNT, 1);
  });

  it("до порога платится цена тарифа и ни центом меньше", () => {
    for (const accounts of [1, 10, VOLUME_THRESHOLD]) {
      expect(monthlyTotalUsd(accounts)).toBe(PLAN_LIMITS.scale.priceUsd);
    }
  });

  it("каждый следующий аккаунт прибавляет ровно оптовую цену", () => {
    expect(monthlyTotalUsd(VOLUME_THRESHOLD + 1) - monthlyTotalUsd(VOLUME_THRESHOLD)).toBe(
      VOLUME_ACCOUNT_PRICE_USD,
    );
    expect(monthlyTotalUsd(40)).toBe(PLAN_LIMITS.scale.priceUsd + 15 * VOLUME_ACCOUNT_PRICE_USD);
  });

  it("обрыва нет: добавленный клиент никогда не уменьшает наш доход", () => {
    /**
     * Главное свойство выбранной формы. Если бы скидка распространялась на
     * все аккаунты сразу, двадцать шестой клиент снижал бы платёж против
     * двадцати пяти, и рост агентства стоил бы нам денег.
     */
    for (let accounts = 1; accounts < 80; accounts++) {
      expect(monthlyTotalUsd(accounts + 1)).toBeGreaterThanOrEqual(monthlyTotalUsd(accounts));
    }
  });

  it("средняя цена аккаунта падает с объёмом, но не ниже оптовой", () => {
    // На пороге это ровно цена тарифа, делённая на его вместимость:
    // $100 в тексте — округление этой величины, а не она сама.
    expect(effectiveAccountPriceUsd(VOLUME_THRESHOLD)).toBe(
      PLAN_LIMITS.scale.priceUsd / PLAN_LIMITS.scale.clientLimit,
    );
    expect(effectiveAccountPriceUsd(50)).toBeLessThan(LIST_ACCOUNT_PRICE_USD);
    expect(effectiveAccountPriceUsd(1000)).toBeGreaterThan(VOLUME_ACCOUNT_PRICE_USD);
    expect(effectiveAccountPriceUsd(0)).toBe(0);
  });

  it("комиссия ограничена сроком", () => {
    expect(REFERRAL_RATE).toBe(0.2);
    expect(REFERRAL_MONTHS).toBe(12);
  });
});

describe("докупленные аккаунты в правах агентства", () => {
  const paying = {
    plan: "scale",
    status: "active",
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
  } as const;

  it("прибавляются к вместимости тарифа", () => {
    expect(entitlementsFor({ ...paying, extraClientAccounts: 15 }).clientLimit).toBe(
      PLAN_LIMITS.scale.clientLimit + 15,
    );
  });

  it("без них ничего не меняется", () => {
    expect(entitlementsFor(paying).clientLimit).toBe(PLAN_LIMITS.scale.clientLimit);
  });

  it("не переживают отмену подписки", () => {
    // За них тоже перестали платить. Оставить их значило бы раздавать
    // вместимость тому, кто ушёл.
    const canceled = entitlementsFor({
      ...paying,
      status: "canceled",
      extraClientAccounts: 15,
    });
    expect(canceled.clientLimit).toBe(PLAN_LIMITS.starter.clientLimit);
  });

  it("отрицательное число не отрезает клиентов", () => {
    // Опечатка в служебном поле не должна оставлять агентство с потолком
    // ниже того, за что оно платит.
    expect(entitlementsFor({ ...paying, extraClientAccounts: -5 }).clientLimit).toBe(
      PLAN_LIMITS.scale.clientLimit,
    );
  });
});
