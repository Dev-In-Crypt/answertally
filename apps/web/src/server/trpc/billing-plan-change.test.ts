import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  FREE_CHECK_ALLOWANCE,
  UnconfiguredPaymentProvider,
  type CancelInput,
  type ChangePlanInput,
  type CheckoutInput,
  type PaymentProvider,
} from "@repo/core";
import { createAgency, createClient, createDb, deleteAgency, upsertSubscription } from "@repo/db";
import { appRouter } from "./root";
import type { SessionUser, TrpcContext } from "./context";
import { setPaymentProvider } from "../payments";
import { estimateUpgradeChargeUsd } from "./routers/billing";

/**
 * Апгрейд, даунгрейд, отмена и возврат из неё.
 *
 * Главное, что проверяется: платящее агентство не получает второй checkout
 * (это была бы вторая подписка и второй счёт за один продукт), а в базу
 * при нажатии кнопки не пишется ничего — тариф приезжает вебхуком.
 */

const { db, close } = createDb();

afterAll(async () => {
  setPaymentProvider(null);
  await close();
});

function caller(agencyId: string, role: SessionUser["role"] = "owner") {
  const user: SessionUser = {
    id: crypto.randomUUID(),
    email: "owner@test.local",
    name: "Owner",
    agencyId,
    role,
  };
  return appRouter.createCaller({ db, user } as TrpcContext);
}

function spyProvider() {
  const calls = {
    checkout: vi.fn(async (_input: CheckoutInput) => ({
      url: "https://checkout.test/cs_1",
      sessionId: "cs_1",
    })),
    changePlan: vi.fn(async (_input: ChangePlanInput) => undefined),
    setCancelAtPeriodEnd: vi.fn(async (_input: CancelInput) => undefined),
  };

  const provider: PaymentProvider = {
    configured: true,
    createCheckout: calls.checkout,
    createPortal: async () => ({ url: "https://portal.test" }),
    changePlan: calls.changePlan,
    setCancelAtPeriodEnd: calls.setCancelAtPeriodEnd,
    parseEvent: () => Promise.reject(new Error("not used here")),
  };

  setPaymentProvider(provider);
  return calls;
}

describe("billing plan changes", () => {
  let agencyId = "";
  let calls: ReturnType<typeof spyProvider>;

  beforeEach(async () => {
    calls = spyProvider();
    const agency = await createAgency(db, { name: "Paying Agency", clientLimit: 3 });
    agencyId = agency.id;
  });

  afterEach(async () => {
    await deleteAgency(db, agencyId);
  });

  async function giveSubscription(patch: Partial<Parameters<typeof upsertSubscription>[1]> = {}) {
    return upsertSubscription(db, {
      agencyId,
      customerId: `cus_${agencyId.slice(0, 8)}`,
      subscriptionId: "sub_live",
      plan: "growth",
      status: "active",
      currentPeriodEnd: new Date("2026-11-01T00:00:00.000Z"),
      cancelAtPeriodEnd: false,
      ...patch,
    });
  }

  it("без подписки агентство идёт в checkout", async () => {
    const result = await caller(agencyId).billing.checkout({ plan: "growth" });

    expect(result.url).toBe("https://checkout.test/cs_1");
    expect(calls.checkout).toHaveBeenCalledTimes(1);
  });

  it("платящее агентство не получает второй checkout", async () => {
    await giveSubscription();

    await expect(caller(agencyId).billing.checkout({ plan: "scale" })).rejects.toThrow(
      /already has a subscription/i,
    );
    expect(calls.checkout).not.toHaveBeenCalled();
  });

  it("апгрейд правит цену в существующей подписке", async () => {
    await giveSubscription();

    const result = await caller(agencyId).billing.changePlan({ plan: "scale" });

    expect(result).toEqual({ plan: "scale", changed: true });
    expect(calls.changePlan).toHaveBeenCalledWith({
      subscriptionId: "sub_live",
      plan: "scale",
    });
    expect(calls.checkout).not.toHaveBeenCalled();
  });

  it("даунгрейд идёт тем же путём", async () => {
    await giveSubscription({ plan: "scale" });

    await caller(agencyId).billing.changePlan({ plan: "starter" });

    expect(calls.changePlan).toHaveBeenCalledWith({
      subscriptionId: "sub_live",
      plan: "starter",
    });
  });

  it("даунгрейд ниже числа заведённых клиентов не проходит", async () => {
    await giveSubscription({ plan: "scale" });
    // Starter держит троих — заводим четвёртого.
    for (const index of [1, 2, 3, 4]) {
      await createClient(db, {
        agencyId,
        name: `Client ${index}`,
        domain: `client-${index}-${agencyId.slice(0, 8)}.test`,
      });
    }

    await expect(caller(agencyId).billing.changePlan({ plan: "starter" })).rejects.toThrow(
      /Archive 1 client/,
    );

    // Провайдера не трогаем вовсе: отказ должен случиться до списания, а не
    // после — иначе агентство уже заплатило за тариф, в который не влезает.
    expect(calls.changePlan).not.toHaveBeenCalled();
  });

  it("даунгрейд ровно под лимит проходит", async () => {
    await giveSubscription({ plan: "scale" });
    for (const index of [1, 2, 3]) {
      await createClient(db, {
        agencyId,
        name: `Fits ${index}`,
        domain: `fits-${index}-${agencyId.slice(0, 8)}.test`,
      });
    }

    await caller(agencyId).billing.changePlan({ plan: "starter" });

    expect(calls.changePlan).toHaveBeenCalledWith({
      subscriptionId: "sub_live",
      plan: "starter",
    });
  });

  it("переход на текущий тариф ничего не трогает", async () => {
    await giveSubscription();

    const result = await caller(agencyId).billing.changePlan({ plan: "growth" });

    expect(result).toEqual({ plan: "growth", changed: false });
    expect(calls.changePlan).not.toHaveBeenCalled();
  });

  it("нажатие кнопки не меняет тариф в базе — это делает вебхук", async () => {
    await giveSubscription();

    await caller(agencyId).billing.changePlan({ plan: "scale" });

    const state = await caller(agencyId).billing.subscription();
    // Пока провайдер не подтвердил, агентство остаётся на оплаченном тарифе.
    expect(state.entitlements.plan).toBe("growth");
  });

  it("отмена и возврат ходят в провайдера с нужным значением", async () => {
    await giveSubscription();

    await caller(agencyId).billing.cancel();
    await caller(agencyId).billing.resume();

    expect(calls.setCancelAtPeriodEnd.mock.calls.map(([input]) => input.cancelAtPeriodEnd)).toEqual([
      true,
      false,
    ]);
  });

  it("у отменённой подписки менять нечего — предлагается начать заново", async () => {
    await giveSubscription({ status: "canceled" });

    await expect(caller(agencyId).billing.changePlan({ plan: "scale" })).rejects.toThrow(
      /no live subscription/i,
    );
    await expect(caller(agencyId).billing.cancel()).rejects.toThrow(/no live subscription/i);
  });

  it("закрывающуюся подписку не двигают: сначала её надо оставить", async () => {
    await giveSubscription({ cancelAtPeriodEnd: true });

    await expect(caller(agencyId).billing.changePlan({ plan: "starter" })).rejects.toThrow(
      /keep the subscription first/i,
    );
    expect(calls.changePlan).not.toHaveBeenCalled();
  });

  it("отказ провайдера — понятной фразой, без его сырого ответа", async () => {
    await giveSubscription();
    calls.changePlan.mockRejectedValueOnce(new Error('Creem responded 400: {"trace_id":"x"}'));
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);

    const attempt = caller(agencyId).billing.changePlan({ plan: "scale" });
    await expect(attempt).rejects.toThrow(/payment provider did not accept/i);
    await expect(attempt).rejects.not.toThrow(/trace_id/);
    quiet.mockRestore();
  });

  it("при сбое платежа сначала карта: тариф и отмена не двигаются", async () => {
    // Провайдер такую подписку не двигает (`subscription_not_active`), и
    // «попробуйте через минуту» тут было бы неправдой.
    await giveSubscription({ status: "past_due" });

    await expect(caller(agencyId).billing.changePlan({ plan: "scale" })).rejects.toThrow(
      /update the card/i,
    );
    await expect(caller(agencyId).billing.cancel()).rejects.toThrow(/update the card/i);
    expect(calls.changePlan).not.toHaveBeenCalled();
    expect(calls.setCancelAtPeriodEnd).not.toHaveBeenCalled();
  });

  it("бесплатный аккаунт видит бесплатный аудит, а не месячный лимит starter", async () => {
    const state = await caller(agencyId).billing.subscription();
    expect(state.aiChecks).toMatchObject({ free: true, allowance: FREE_CHECK_ALLOWANCE });
    expect(state.entitlements.reason).toMatch(/free audit/i);

    const usage = await caller(agencyId).billing.usage();
    expect(usage.aiChecks).toMatchObject({ free: true, allowance: FREE_CHECK_ALLOWANCE });
  });

  it("платящему — месячный лимит тарифа и оценка доплаты только вверх", async () => {
    await giveSubscription({ currentPeriodEnd: new Date(Date.now() + 15 * 86_400_000) });

    const state = await caller(agencyId).billing.subscription();
    expect(state.aiChecks).toMatchObject({ free: false, allowance: 10_000 });
    const byId = Object.fromEntries(state.plans.map((plan) => [plan.id, plan]));
    expect(byId.starter?.estimatedChargeNowUsd).toBeNull();
    expect(byId.growth?.estimatedChargeNowUsd).toBeNull();
    expect(byId.scale?.estimatedChargeNowUsd).toBeGreaterThan(0);
    // Доплата Growth → Scale меньше разницы цен ($1,199 − $599).
    expect(byId.scale?.estimatedChargeNowUsd).toBeLessThan(600);
  });

  it("экран знает, что платёжные кнопки не для участника", async () => {
    expect((await caller(agencyId).billing.subscription()).canManage).toBe(true);
    expect((await caller(agencyId, "admin").billing.subscription()).canManage).toBe(false);
    expect((await caller(agencyId, "member").billing.subscription()).canManage).toBe(false);
  });

  it("менять тариф может только владелец", async () => {
    await giveSubscription();

    await expect(
      caller(agencyId, "member").billing.changePlan({ plan: "scale" }),
    ).rejects.toBeInstanceOf(TRPCError);
    expect(calls.changePlan).not.toHaveBeenCalled();
  });

  it("без ключей экран работает, а кнопки честно отказывают", async () => {
    setPaymentProvider(new UnconfiguredPaymentProvider());
    await giveSubscription();

    const state = await caller(agencyId).billing.subscription();
    expect(state.paymentsConfigured).toBe(false);
    // Продукт при этом живой: тариф и лимиты читаются.
    expect(state.entitlements.active).toBe(true);
    expect(state.plans).toHaveLength(3);

    for (const attempt of [
      () => caller(agencyId).billing.changePlan({ plan: "scale" }),
      () => caller(agencyId).billing.cancel(),
      () => caller(agencyId).billing.resume(),
      () => caller(agencyId).billing.checkout({ plan: "scale" }),
    ]) {
      await expect(attempt()).rejects.toThrow(/not connected/i);
    }
  });
});

describe("estimateUpgradeChargeUsd", () => {
  const end = new Date("2026-11-15T00:00:00.000Z");

  it.each([
    // [from, to, now, expected]
    [1_299, 2_499, "2026-10-15T00:00:00.000Z", 1_200], // весь период впереди
    [1_299, 2_499, "2026-10-31T00:00:00.000Z", 580.65], // 15 из 31 дня
    [1_299, 2_499, "2026-11-15T00:00:00.000Z", 0], // период кончился
    [1_299, 2_499, "2026-12-01T00:00:00.000Z", 0], // и давно — не в минус
    [1_299, 2_499, "2026-10-01T00:00:00.000Z", 1_200], // часы разошлись — не больше разницы
  ])("%d → %d на %s: %d", (from, to, now, expected) => {
    expect(estimateUpgradeChargeUsd(from, to, end, new Date(now))).toBeCloseTo(expected, 2);
  });

  it("вниз и без конца периода — оценки нет", () => {
    expect(estimateUpgradeChargeUsd(2_499, 499, end)).toBeNull();
    expect(estimateUpgradeChargeUsd(499, 2_499, null)).toBeNull();
  });

  it("31-е: начало периода — последний день прошлого месяца, а не 3-е", () => {
    const march31 = new Date("2026-03-31T00:00:00.000Z");
    // Февраль 2026 — 28 дней: на 14 марта впереди 17 из 31 дня (28.02 → 31.03).
    expect(
      estimateUpgradeChargeUsd(0, 3_100, march31, new Date("2026-03-14T00:00:00.000Z")),
    ).toBeCloseTo(1_700, 2);
  });
});
