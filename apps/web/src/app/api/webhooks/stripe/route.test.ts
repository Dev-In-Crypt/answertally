import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  hmacSha256Hex,
  PAST_DUE_GRACE_DAYS,
  PLAN_LIMITS,
  StripePaymentProvider,
} from "@repo/core";
import {
  createAgency,
  createDb,
  deleteAgency,
  getAgencyById,
  getSubscriptionByAgency,
} from "@repo/db";
import { setPaymentEventLedger, setPaymentProvider } from "@/server/payments";
import { appRouter } from "@/server/trpc/root";
import type { SessionUser, TrpcContext } from "@/server/trpc/context";
import type * as SubscriptionModule from "@/server/subscription";
import { POST } from "./route";

/**
 * Сбой записи подменяется на уровне модуля: в тесте нужен именно упавший
 * `applySubscriptionChange`, потому что только он проверяет, что событие
 * после сбоя отпущено и повтор его применит. Обычно подмена выключена и
 * вызов уходит в настоящую реализацию.
 */
const writeFailure = vi.hoisted(() => ({ once: false }));

vi.mock("@/server/subscription", async (importOriginal) => {
  const actual = await importOriginal<typeof SubscriptionModule>();
  return {
    ...actual,
    applySubscriptionChange: async (
      ...args: Parameters<typeof actual.applySubscriptionChange>
    ): ReturnType<typeof actual.applySubscriptionChange> => {
      if (writeFailure.once) {
        writeFailure.once = false;
        throw new Error("the database is unavailable");
      }
      return actual.applySubscriptionChange(...args);
    },
  };
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

/**
 * Вебхук — единственный вход, который меняет права агентства без участия
 * человека, поэтому проверяется целиком: настоящая подпись HMAC, повторная
 * доставка того же события и счёт, который не должен стирать срок отсрочки.
 */

const { db, close } = createDb();

const SECRET = "whsec_test_only_not_a_real_key";
const PRICES = { starter: "price_starter", growth: "price_growth", scale: "price_scale" };

const provider = new StripePaymentProvider({
  secretKey: "sk_test_not_a_real_key",
  webhookSecret: SECRET,
  prices: PRICES,
  // Сеть не трогается: вебхук ходит только в разбор подписи.
  fetchImpl: (() => {
    throw new Error("the webhook must not call Stripe");
  }) as unknown as typeof fetch,
});

afterAll(async () => {
  setPaymentProvider(null);
  setPaymentEventLedger(null);
  await close();
});

/** Подпись считается тем же алгоритмом, что у Stripe, а не подменяется. */
async function post(event: unknown, at = new Date()): Promise<Response> {
  /**
   * Имя события уникально для прогона.
   *
   * Журнал теперь в базе и переживает не только процесс, но и прогон
   * тестов: с постоянными именами второй запуск нашёл бы все события уже
   * обработанными. Внутри прогона имена остаются говорящими, и повтор
   * одного события остаётся повтором.
   */
  const withRunId = { ...(event as Record<string, unknown>) };
  if (typeof withRunId["id"] === "string") {
    withRunId["id"] = `${withRunId["id"]}_${RUN}`;
  }

  const payload = JSON.stringify(withRunId);
  const timestamp = Math.floor(at.getTime() / 1000);
  const signature = await hmacSha256Hex(SECRET, `${timestamp}.${payload}`);

  return POST(
    new Request("https://app.test/api/webhooks/stripe", {
      method: "POST",
      headers: { "stripe-signature": `t=${timestamp},v1=${signature}` },
      body: payload,
    }),
  );
}

function subscriptionEvent(patch: {
  id: string;
  agencyId?: string;
  customerId: string;
  price?: string;
  status?: string;
  type?: string;
  periodEnd?: number;
  cancelAtPeriodEnd?: boolean;
  /** Время события у провайдера (секунды). Им определяется порядок. */
  created?: number;
}) {
  return {
    id: patch.id,
    object: "event",
    api_version: "2025-04-30.basil",
    created: patch.created ?? 1_790_000_000,
    type: patch.type ?? "customer.subscription.updated",
    data: {
      object: {
        id: "sub_live_1",
        object: "subscription",
        customer: patch.customerId,
        status: patch.status ?? "active",
        cancel_at_period_end: patch.cancelAtPeriodEnd ?? false,
        ...(patch.agencyId ? { metadata: { agency_id: patch.agencyId } } : { metadata: {} }),
        items: {
          object: "list",
          data: [
            {
              id: "si_live_1",
              object: "subscription_item",
              current_period_end: patch.periodEnd ?? 1_792_000_000,
              price: { id: patch.price ?? "price_growth", object: "price" },
              quantity: 1,
            },
          ],
        },
      },
    },
  };
}

/** Метка прогона: журнал в базе живёт дольше, чем тесты. */
const RUN = Math.random().toString(36).slice(2, 10);

describe("stripe webhook", () => {
  let agencyId = "";
  let customerId = "";

  beforeEach(async () => {
    setPaymentProvider(provider);
    // Настоящий журнал, а не заглушка: вебхук проверяется тем же путём,
    // которым он работает в проде.
    setPaymentEventLedger(null);
    const agency = await createAgency(db, { name: "Webhook Agency", clientLimit: 3 });
    agencyId = agency.id;
    customerId = `cus_${agency.id.slice(0, 8)}`;
  });

  afterEach(async () => {
    await deleteAgency(db, agencyId);
  });

  it("без подписи ничего не происходит", async () => {
    const response = await POST(
      new Request("https://app.test/api/webhooks/stripe", { method: "POST", body: "{}" }),
    );

    expect(response.status).toBe(400);
  });

  it("подпись чужим секретом отвергается, план не меняется", async () => {
    const payload = JSON.stringify(subscriptionEvent({ id: "evt_forged", agencyId, customerId }));
    const timestamp = Math.floor(Date.now() / 1000);
    const forged = await hmacSha256Hex("whsec_someone_else", `${timestamp}.${payload}`);

    const response = await POST(
      new Request("https://app.test/api/webhooks/stripe", {
        method: "POST",
        headers: { "stripe-signature": `t=${timestamp},v1=${forged}` },
        body: payload,
      }),
    );

    expect(response.status).toBe(400);
    expect(await getSubscriptionByAgency(db, agencyId)).toBeUndefined();
  });

  it("оплата поднимает тариф агентства", async () => {
    const response = await post(
      subscriptionEvent({ id: "evt_paid", agencyId, customerId, price: "price_scale" }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ applied: true });

    const agency = await getAgencyById(db, agencyId);
    expect(agency?.plan).toBe("scale");
    expect(agency?.clientLimit).toBe(PLAN_LIMITS.scale.clientLimit);
  });

  it("повторная доставка того же события второй раз ничего не меняет", async () => {
    const event = subscriptionEvent({ id: "evt_once", agencyId, customerId, price: "price_scale" });

    await post(event);
    const saved = await getSubscriptionByAgency(db, agencyId);

    // Stripe повторяет доставку после таймаута — с тем же идентификатором.
    const repeat = await post(event);
    expect(repeat.status).toBe(200);
    await expect(repeat.json()).resolves.toMatchObject({ applied: false, status: "duplicate" });

    const after = await getSubscriptionByAgency(db, agencyId);
    expect(after?.plan).toBe("scale");
    // Ни новой записи, ни нового времени правки: второй проход не состоялся.
    expect(after?.id).toBe(saved?.id);
    expect(after?.updatedAt.toISOString()).toBe(saved?.updatedAt.toISOString());
  });

  it("повтор того же события после отмены отбивается журналом по его id", async () => {
    // Про порядок событий этот тест не говорит ничего — он про повтор с тем
    // же идентификатором. Порядок проверяет следующий тест.
    const paid = subscriptionEvent({ id: "evt_a", agencyId, customerId, price: "price_scale" });
    const cancelled = subscriptionEvent({
      id: "evt_b",
      agencyId,
      customerId,
      price: "price_scale",
      type: "customer.subscription.deleted",
    });

    await post(paid);
    await post(cancelled);
    // Провайдер повторяет первое событие, потому что наш ответ на него потерялся.
    const repeat = await post(paid);
    await expect(repeat.json()).resolves.toMatchObject({ status: "duplicate" });

    const agency = await getAgencyById(db, agencyId);
    expect(agency?.plan).toBe("starter");
    expect((await getSubscriptionByAgency(db, agencyId))?.status).toBe("canceled");
  });

  it("задержавшееся событие с другим id не откатывает тариф назад", async () => {
    // Stripe порядок доставки не гарантирует, а идентификаторы у этих
    // событий разные — журнал по id тут не помогает.
    await post(
      subscriptionEvent({
        id: "evt_first",
        agencyId,
        customerId,
        price: "price_growth",
        created: 1_790_000_000,
      }),
    );

    // Агентство перешло на scale.
    await post(
      subscriptionEvent({
        id: "evt_newer",
        agencyId,
        customerId,
        price: "price_scale",
        created: 1_790_500_000,
      }),
    );

    // А следом приезжает застрявший повтор более раннего события.
    const stale = await post(
      subscriptionEvent({
        id: "evt_older",
        agencyId,
        customerId,
        price: "price_starter",
        created: 1_790_200_000,
      }),
    );

    expect(stale.status).toBe(200);
    await expect(stale.json()).resolves.toMatchObject({ applied: false, status: "ignored" });

    // Лимит клиентов на scale должен остаться: 26-й клиент агентства не
    // должен упереться в starter из-за порядка доставки.
    const saved = await getSubscriptionByAgency(db, agencyId);
    expect(saved?.plan).toBe("scale");
    expect((await getAgencyById(db, agencyId))?.clientLimit).toBe(PLAN_LIMITS.scale.clientLimit);
  });

  it("событие о подписке не отбрасывается по времени: только оно приносит тариф", async () => {
    // Завершённый checkout и создание подписки происходят в одну секунду, и
    // порядок доставки между ними произвольный. Проверка порядка не должна
    // отбросить событие о подписке только потому, что checkout доехал
    // первым: тогда тариф не приедет никогда.
    await post({
      id: "evt_checkout",
      object: "event",
      created: 1_790_900_000,
      type: "checkout.session.completed",
      data: {
        object: {
          id: "cs_live_1",
          object: "checkout.session",
          customer: customerId,
          subscription: "sub_live_1",
          client_reference_id: agencyId,
        },
      },
    });

    const created = await post(
      subscriptionEvent({
        id: "evt_created",
        agencyId,
        customerId,
        price: "price_scale",
        type: "customer.subscription.created",
        created: 1_790_899_999,
      }),
    );

    await expect(created.json()).resolves.toMatchObject({ applied: true });
    expect((await getSubscriptionByAgency(db, agencyId))?.plan).toBe("scale");
  });

  it("сбой списания оставляет тариф и срок оплаченного периода на месте", async () => {
    await post(
      subscriptionEvent({
        id: "evt_c",
        agencyId,
        customerId,
        price: "price_scale",
        periodEnd: 1_792_000_000,
      }),
    );

    const failure = {
      id: "evt_d",
      object: "event",
      created: 1_791_000_000,
      type: "invoice.payment_failed",
      data: {
        object: {
          id: "in_1",
          object: "invoice",
          customer: customerId,
          billing_reason: "subscription_cycle",
          attempt_count: 1,
          status: "open",
          parent: { subscription_details: { subscription: "sub_live_1" } },
        },
      },
    };

    const response = await post(failure);
    expect(await response.json()).toMatchObject({ applied: true });

    const saved = await getSubscriptionByAgency(db, agencyId);
    expect(saved?.status).toBe("past_due");
    // Счёт не знает тарифа — записанный не должен превратиться в starter.
    expect(saved?.plan).toBe("scale");
    // И не знает срока — без него отсрочка считалась бы от пустоты.
    expect(saved?.currentPeriodEnd?.toISOString()).toBe(
      new Date(1_792_000_000 * 1000).toISOString(),
    );
  });

  it("удачное списание возвращает агентство в строй", async () => {
    await post(
      subscriptionEvent({
        id: "evt_e",
        agencyId,
        customerId,
        price: "price_growth",
        status: "past_due",
      }),
    );

    await post({
      id: "evt_f",
      object: "event",
      created: 1_791_500_000,
      type: "invoice.payment_succeeded",
      data: {
        object: {
          id: "in_2",
          object: "invoice",
          customer: customerId,
          billing_reason: "subscription_cycle",
          status: "paid",
          parent: { subscription_details: { subscription: "sub_live_1" } },
        },
      },
    });

    const saved = await getSubscriptionByAgency(db, agencyId);
    expect(saved?.status).toBe("active");
    expect(saved?.plan).toBe("growth");
  });

  it("счёт не стирает отметку о порядке — иначе защита открывается сама", async () => {
    /**
     * Счёт тарифа не приносит и отметку не ставит. Но `upsertSubscription`
     * переписывает это поле наравне с прочими, и передать по нему `null`
     * значило бы стереть отметку: следующий застрявший повтор прошёл бы
     * как ни в чём не бывало и откатил тариф.
     *
     * Здесь между двумя событиями о подписке вклинивается обычное удачное
     * списание — ровно то, что приходит у любого платящего агентства раз
     * в месяц.
     */
    await post(
      subscriptionEvent({
        id: "evt_before_invoice",
        agencyId,
        customerId,
        price: "price_scale",
        created: 1_790_500_000,
      }),
    );

    await post({
      id: "evt_routine_invoice",
      object: "event",
      created: 1_790_600_000,
      type: "invoice.payment_succeeded",
      data: {
        object: {
          id: "in_routine",
          object: "invoice",
          customer: customerId,
          billing_reason: "subscription_cycle",
          status: "paid",
          parent: { subscription_details: { subscription: "sub_live_1" } },
        },
      },
    });

    const stale = await post(
      subscriptionEvent({
        id: "evt_stale_after_invoice",
        agencyId,
        customerId,
        price: "price_starter",
        created: 1_790_200_000,
      }),
    );

    await expect(stale.json()).resolves.toMatchObject({ applied: false, status: "ignored" });

    const saved = await getSubscriptionByAgency(db, agencyId);
    expect(saved?.plan).toBe("scale");
    expect(saved?.lastEventAt).not.toBeNull();
  });

  it("событие, которое продукт не разбирает, отмечается доставленным", async () => {
    const response = await post({
      id: "evt_g",
      object: "event",
      created: 1_790_000_000,
      type: "customer.updated",
      data: { object: { id: customerId, object: "customer" } },
    });

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ status: "ignored" });
  });

  it("сбой записи отпускает событие, и повтор его применяет", async () => {
    const event = subscriptionEvent({ id: "evt_h", agencyId, customerId, price: "price_scale" });

    // Первая доставка падает на записи в базу: событие уже занято журналом,
    // и без явного отпускания оно потеряно навсегда.
    writeFailure.once = true;
    const failed = await post(event);

    expect(failed.status).toBe(500);
    expect(await getSubscriptionByAgency(db, agencyId)).toBeUndefined();

    // Провайдер повторяет доставку того же события после нашего 500.
    const retry = await post(event);

    expect(retry.status).toBe(200);
    await expect(retry.json()).resolves.toMatchObject({ applied: true });
    expect((await getSubscriptionByAgency(db, agencyId))?.plan).toBe("scale");
  });

  it("просроченная оплата в пределах отсрочки не мешает работать", async () => {
    // Период кончился вчера: банк отклонил списание, но это ещё клиент.
    const yesterday = Math.floor((Date.now() - 86_400_000) / 1000);
    await post(
      subscriptionEvent({
        id: "evt_grace",
        agencyId,
        customerId,
        price: "price_growth",
        status: "past_due",
        periodEnd: yesterday,
        // Событие «сейчас»: отсрочка считается от него, и фиксированная дата
        // протухала бы сама через две недели после написания теста.
        created: Math.floor(Date.now() / 1000),
      }),
    );

    const created = await caller(agencyId).clients.create({
      name: "Client inside grace",
      domain: "inside-grace.test",
    });

    expect(created.id).toBeTruthy();
  });

  it("после отсрочки продукт закрывается, а не молчит", async () => {
    const longAgo = Math.floor((Date.now() - (PAST_DUE_GRACE_DAYS + 5) * 86_400_000) / 1000);
    await post(
      subscriptionEvent({
        id: "evt_lapsed",
        agencyId,
        customerId,
        price: "price_growth",
        status: "past_due",
        periodEnd: longAgo,
      }),
    );

    await expect(
      caller(agencyId).clients.create({ name: "Too late", domain: "too-late.test" }),
    ).rejects.toThrow(/suspended/i);
  });

  it("чужая отмена не трогает наше агентство", async () => {
    await post(subscriptionEvent({ id: "evt_i", agencyId, customerId, price: "price_scale" }));

    const response = await post(
      subscriptionEvent({
        id: "evt_j",
        customerId: "cus_someone_else",
        type: "customer.subscription.deleted",
      }),
    );

    await expect(response.json()).resolves.toMatchObject({ applied: false });
    expect((await getAgencyById(db, agencyId))?.plan).toBe("scale");
  });
});
