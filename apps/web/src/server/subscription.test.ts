import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { PLAN_LIMITS, type SubscriptionChange } from "@repo/core";
import {
  createAgency,
  createClient,
  createDb,
  deleteAgency,
  getAgencyById,
  getSubscriptionByAgency,
} from "@repo/db";
import { appRouter } from "./trpc/root";
import type { SessionUser, TrpcContext } from "./trpc/context";
import { applySubscriptionChange, entitlementsForAgency } from "./subscription";

/**
 * Verify T86: событие провайдера меняет план и лимит агентства, событие без
 * связи ни к кому не применяется, а исчерпанный лимит останавливает создание
 * клиента понятной ошибкой.
 */

const { db, close } = createDb();

afterAll(async () => {
  await close();
});

function caller(agencyId: string) {
  const user: SessionUser = {
    id: crypto.randomUUID(),
    email: "owner@test.local",
    name: "Owner",
    agencyId,
    role: "owner",
  };
  return appRouter.createCaller({ db, user } as TrpcContext);
}

function change(patch: Partial<SubscriptionChange> = {}): SubscriptionChange {
  return {
    kind: "subscription",
    agencyId: null,
    customerId: `cus_${crypto.randomUUID().slice(0, 8)}`,
    subscriptionId: "sub_1",
    plan: "growth",
    status: "active",
    currentPeriodEnd: new Date("2026-10-01T00:00:00.000Z"),
    cancelAtPeriodEnd: false,
    ...patch,
  };
}

describe("applySubscriptionChange", () => {
  let agencyId = "";

  beforeEach(async () => {
    const agency = await createAgency(db, { name: "Billing Agency", clientLimit: 3 });
    agencyId = agency.id;
  });

  afterEach(async () => {
    await deleteAgency(db, agencyId);
  });

  it("оплата поднимает план и лимит клиентов", async () => {
    const outcome = await applySubscriptionChange(db, change({ agencyId, plan: "growth" }));

    expect(outcome).toMatchObject({ applied: true, plan: "growth", status: "active" });

    const agency = await getAgencyById(db, agencyId);
    expect(agency?.plan).toBe("growth");
    expect(agency?.clientLimit).toBe(PLAN_LIMITS.growth.clientLimit);

    const entitlements = await entitlementsForAgency(db, agencyId);
    expect(entitlements.active).toBe(true);
    expect(entitlements.aiCheckAllowance).toBe(PLAN_LIMITS.growth.aiCheckAllowance);
  });

  it("второе событие по тому же плательщику находит агентство без метки", async () => {
    const customerId = "cus_stable";
    await applySubscriptionChange(db, change({ agencyId, customerId, plan: "scale" }));

    // В событиях об изменении подписки метки агентства может не быть.
    const outcome = await applySubscriptionChange(
      db,
      change({ agencyId: null, customerId, plan: null, status: "past_due" }),
    );

    expect(outcome).toMatchObject({ applied: true, plan: "scale", status: "past_due" });

    const saved = await getSubscriptionByAgency(db, agencyId);
    expect(saved?.plan).toBe("scale");
  });

  it("событие, не связанное ни с кем, не применяется", async () => {
    const outcome = await applySubscriptionChange(
      db,
      change({ agencyId: null, customerId: "cus_unknown_to_us" }),
    );

    expect(outcome).toEqual({ applied: false, reason: "No agency is linked to this customer." });
  });

  it("отмена возвращает агентство к starter", async () => {
    await applySubscriptionChange(db, change({ agencyId, plan: "scale" }));
    await applySubscriptionChange(db, change({ agencyId, plan: "scale", status: "canceled" }));

    const agency = await getAgencyById(db, agencyId);
    expect(agency?.plan).toBe("starter");
    expect(agency?.clientLimit).toBe(PLAN_LIMITS.starter.clientLimit);

    const entitlements = await entitlementsForAgency(db, agencyId);
    expect(entitlements.active).toBe(false);
  });

  it("поздний checkout или счёт не воскрешает отменённую подписку", async () => {
    // «Оплатить и сразу отменить» при поздней доставке давало вечный active.
    const customerId = "cus_revive";
    await applySubscriptionChange(db, change({ agencyId, customerId, plan: "scale" }));
    await applySubscriptionChange(
      db,
      change({ agencyId, customerId, plan: "scale", status: "canceled" }),
    );

    const outcome = await applySubscriptionChange(
      db,
      change({ agencyId, customerId, plan: null, status: "active", unknownFields: ["plan"] }),
    );

    expect(outcome.applied).toBe(false);
    expect((await getSubscriptionByAgency(db, agencyId))?.status).toBe("canceled");
  });

  it("возврат денег закрывает доступ, но не стирает номер подписки", async () => {
    // С пустым номером экран оплаты предлагал бы вторую подписку, а поздний
    // счёт той же подписки воскрешал бы отменённую.
    const customerId = "cus_refund";
    await applySubscriptionChange(db, change({ agencyId, customerId, plan: "growth" }));
    await applySubscriptionChange(
      db,
      change({
        agencyId,
        customerId,
        subscriptionId: null,
        plan: null,
        status: "canceled",
        unknownFields: ["plan"],
      }),
    );

    const saved = await getSubscriptionByAgency(db, agencyId);
    expect(saved?.status).toBe("canceled");
    expect(saved?.subscriptionId).toBe("sub_1");

    const late = await applySubscriptionChange(
      db,
      change({ agencyId, customerId, plan: null, status: "active", unknownFields: ["plan"] }),
    );
    expect(late.applied).toBe(false);
  });

  it("новая подписка после отмены принимается", async () => {
    const customerId = "cus_again";
    await applySubscriptionChange(db, change({ agencyId, customerId, status: "canceled" }));

    const outcome = await applySubscriptionChange(
      db,
      change({ agencyId, customerId, subscriptionId: "sub_2", plan: "growth" }),
    );

    expect(outcome).toMatchObject({ applied: true, status: "active" });
  });

  it("событие чужой подписки того же плательщика не трогает действующую", async () => {
    const customerId = "cus_two";
    await applySubscriptionChange(db, change({ agencyId, customerId, plan: "scale" }));

    const outcome = await applySubscriptionChange(
      db,
      change({
        agencyId,
        customerId,
        subscriptionId: "sub_old",
        plan: "starter",
        status: "canceled",
      }),
    );

    expect(outcome.applied).toBe(false);
    expect((await getSubscriptionByAgency(db, agencyId))?.plan).toBe("scale");
  });

  it("отсрочка считается от сбоя оплаты, а не от сдвинутого конца периода", async () => {
    // При продлении конец периода уезжает на месяц вперёд до списания —
    // от него отсрочка была бы сорок четыре дня вместо четырнадцати.
    const customerId = "cus_grace";
    const failedAt = new Date(Date.now() - 20 * 86_400_000);
    await applySubscriptionChange(db, change({ agencyId, customerId, plan: "scale" }));
    await applySubscriptionChange(
      db,
      change({
        agencyId,
        customerId,
        plan: "scale",
        status: "past_due",
        currentPeriodEnd: new Date(Date.now() + 10 * 86_400_000),
      }),
      failedAt,
    );

    expect((await getSubscriptionByAgency(db, agencyId))?.pastDueSince?.getTime()).toBe(
      failedAt.getTime(),
    );
    expect((await entitlementsForAgency(db, agencyId)).active).toBe(false);
  });
});

describe("clients.create against the plan", () => {
  let agencyId = "";

  beforeEach(async () => {
    const agency = await createAgency(db, { name: "Limit Agency", clientLimit: 3 });
    agencyId = agency.id;
  });

  afterEach(async () => {
    await deleteAgency(db, agencyId);
  });

  it("на исчерпанном лимите отказ объясняет, что делать", async () => {
    for (let index = 0; index < PLAN_LIMITS.starter.clientLimit; index++) {
      await createClient(db, {
        agencyId,
        name: `Client ${index}`,
        domain: `client-${index}.test`,
      });
    }

    await expect(
      caller(agencyId).clients.create({
        name: "One too many",
        domain: "toomany.test",
        brandNames: [],
        competitorNames: [],
      }),
    ).rejects.toThrow(/upgrade/i);
  });

  it("после оплаты клиент заводится", async () => {
    for (let index = 0; index < PLAN_LIMITS.starter.clientLimit; index++) {
      await createClient(db, {
        agencyId,
        name: `Client ${index}`,
        domain: `paid-client-${index}.test`,
      });
    }

    await applySubscriptionChange(db, change({ agencyId, plan: "growth" }));

    const created = await caller(agencyId).clients.create({
      name: "Now it fits",
      domain: "nowitfits.test",
      brandNames: [],
      competitorNames: [],
    });

    expect(created.id).toBeDefined();
  });

  it("отменённая подписка останавливает создание клиентов", async () => {
    await applySubscriptionChange(db, change({ agencyId, plan: "growth", status: "canceled" }));

    await expect(
      caller(agencyId).clients.create({
        name: "Blocked",
        domain: "blocked.test",
        brandNames: [],
        competitorNames: [],
      }),
    ).rejects.toThrow(TRPCError);
  });
});
