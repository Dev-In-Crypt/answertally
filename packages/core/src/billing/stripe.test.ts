import { describe, expect, it, vi } from "vitest";
import {
  StripePaymentProvider,
  WebhookSignatureError,
  hmacSha256Hex,
  verifyStripeSignature,
} from "./stripe";
import {
  InMemoryPaymentEventLedger,
  PaymentsNotConfiguredError,
  UnconfiguredPaymentProvider,
} from "./payments";
import { createPaymentProvider } from "./provider";

/**
 * Verify T86: подпись вебхука проверяется по-настоящему (иначе план агентства
 * меняет кто угодно), события переводятся в наши термины, а без ключей
 * продукт не притворяется, что принимает деньги.
 */

const PRICES = { starter: "price_starter", growth: "price_growth", scale: "price_scale" };
const SECRET = "whsec_test";

function provider(overrides: Partial<ConstructorParameters<typeof StripePaymentProvider>[0]> = {}) {
  return new StripePaymentProvider({
    secretKey: "sk_test",
    webhookSecret: SECRET,
    prices: PRICES,
    ...overrides,
  });
}

async function sign(payload: string, at: Date, secret = SECRET): Promise<string> {
  const timestamp = Math.floor(at.getTime() / 1000);
  const signature = await hmacSha256Hex(secret, `${timestamp}.${payload}`);
  return `t=${timestamp},v1=${signature}`;
}

describe("verifyStripeSignature", () => {
  const now = new Date("2026-09-15T12:00:00.000Z");
  const payload = JSON.stringify({ id: "evt_1", type: "ping" });

  it("своя подпись проходит", async () => {
    await expect(
      verifyStripeSignature({ payload, signature: await sign(payload, now), secret: SECRET, now }),
    ).resolves.toBeUndefined();
  });

  it("подпись чужим секретом отвергается", async () => {
    const signature = await sign(payload, now, "whsec_someone_else");

    await expect(
      verifyStripeSignature({ payload, signature, secret: SECRET, now }),
    ).rejects.toBeInstanceOf(WebhookSignatureError);
  });

  it("подменённое тело отвергается", async () => {
    const signature = await sign(payload, now);

    await expect(
      verifyStripeSignature({
        payload: JSON.stringify({ id: "evt_1", type: "customer.subscription.deleted" }),
        signature,
        secret: SECRET,
        now,
      }),
    ).rejects.toBeInstanceOf(WebhookSignatureError);
  });

  it("старая подпись не переигрывается", async () => {
    const signature = await sign(payload, new Date(now.getTime() - 10 * 60_000));

    await expect(
      verifyStripeSignature({ payload, signature, secret: SECRET, now }),
    ).rejects.toThrow(/tolerance/i);
  });

  it("кривой заголовок отвергается", async () => {
    await expect(
      verifyStripeSignature({ payload, signature: "nonsense", secret: SECRET, now }),
    ).rejects.toThrow(/Malformed/i);
  });
});

describe("parseEvent", () => {
  const now = new Date("2026-09-15T12:00:00.000Z");

  async function envelope(event: unknown) {
    const payload = JSON.stringify(event);
    return provider({ now: () => now }).parseEvent(payload, await sign(payload, now));
  }

  async function parse(event: unknown) {
    return (await envelope(event)).event;
  }

  it("конверт несёт идентификатор события и момент его создания", async () => {
    const result = await envelope({
      id: "evt_0",
      type: "customer.subscription.updated",
      created: 1_789_999_000,
      data: {
        object: {
          id: "sub_0",
          customer: "cus_0",
          status: "active",
          items: { data: [{ id: "si_0", price: { id: "price_growth" } }] },
        },
      },
    });

    expect(result.eventId).toBe("evt_0");
    expect(result.type).toBe("customer.subscription.updated");
    expect(result.occurredAt.toISOString()).toBe(new Date(1_789_999_000 * 1000).toISOString());
  });

  it("подписка переводится в план, статус и конец периода", async () => {
    const result = await parse({
      id: "evt_1",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_1",
          customer: "cus_1",
          status: "active",
          cancel_at_period_end: false,
          current_period_end: 1_790_000_000,
          metadata: { agency_id: "agency-uuid" },
          items: { data: [{ price: { id: "price_growth" } }] },
        },
      },
    });

    expect(result).toMatchObject({
      kind: "subscription",
      agencyId: "agency-uuid",
      customerId: "cus_1",
      subscriptionId: "sub_1",
      plan: "growth",
      status: "active",
      cancelAtPeriodEnd: false,
    });
  });

  it("удаление подписки — это отмена, чем бы ни был её статус", async () => {
    const result = await parse({
      id: "evt_2",
      type: "customer.subscription.deleted",
      data: {
        object: {
          id: "sub_1",
          customer: "cus_1",
          status: "active",
          metadata: { agency_id: "agency-uuid" },
          items: { data: [{ price: { id: "price_growth" } }] },
        },
      },
    });

    expect(result).toMatchObject({ kind: "subscription", status: "canceled" });
  });

  it("незнакомая цена не превращается в план наугад", async () => {
    const result = await parse({
      id: "evt_3",
      type: "customer.subscription.updated",
      data: {
        object: {
          id: "sub_2",
          customer: "cus_2",
          status: "active",
          items: { data: [{ price: { id: "price_from_another_product" } }] },
        },
      },
    });

    expect(result).toMatchObject({ kind: "subscription", plan: null });
  });

  it("завершённый checkout приносит плательщика и агентство", async () => {
    const result = await parse({
      id: "evt_4",
      type: "checkout.session.completed",
      data: {
        object: {
          customer: "cus_3",
          subscription: "sub_3",
          client_reference_id: "agency-uuid",
        },
      },
    });

    expect(result).toMatchObject({
      kind: "subscription",
      agencyId: "agency-uuid",
      customerId: "cus_3",
      subscriptionId: "sub_3",
    });
  });

  it("полный возврат денег закрывает подписку, частичный — нет", async () => {
    const full = await parse({
      id: "evt_r1",
      type: "charge.refunded",
      data: { object: { customer: "cus_9", amount: 49900, amount_refunded: 49900 } },
    });
    expect(full).toMatchObject({ kind: "subscription", customerId: "cus_9", status: "canceled" });

    const partial = await parse({
      id: "evt_r2",
      type: "charge.refunded",
      data: { object: { customer: "cus_9", amount: 49900, amount_refunded: 1000 } },
    });
    expect(partial).toMatchObject({ kind: "ignored" });
  });

  it("остальные события пропускаются осознанно", async () => {
    const result = await parse({ id: "evt_5", type: "invoice.paid", data: { object: {} } });

    expect(result).toMatchObject({ kind: "ignored", type: "invoice.paid" });
  });

  it("сбой списания переводит в past_due, не трогая тариф и срок", async () => {
    const result = await parse({
      id: "evt_6",
      type: "invoice.payment_failed",
      created: 1_790_000_100,
      data: {
        object: {
          id: "in_1",
          object: "invoice",
          customer: "cus_4",
          billing_reason: "subscription_cycle",
          attempt_count: 2,
          status: "open",
          parent: {
            type: "subscription_details",
            subscription_details: { subscription: "sub_4", metadata: {} },
          },
        },
      },
    });

    expect(result).toMatchObject({
      kind: "subscription",
      customerId: "cus_4",
      subscriptionId: "sub_4",
      status: "past_due",
      plan: null,
    });
    // Про тариф и конец периода счёт не знает: записанное остаётся.
    expect((result as { unknownFields?: string[] }).unknownFields).toEqual([
      "plan",
      "currentPeriodEnd",
      "cancelAtPeriodEnd",
    ]);
  });

  it("удачное списание возвращает подписку в active", async () => {
    const result = await parse({
      id: "evt_7",
      type: "invoice.payment_succeeded",
      created: 1_790_000_200,
      data: {
        object: {
          id: "in_2",
          object: "invoice",
          customer: "cus_4",
          billing_reason: "subscription_cycle",
          status: "paid",
          parent: { subscription_details: { subscription: "sub_4" } },
        },
      },
    });

    expect(result).toMatchObject({
      kind: "subscription",
      status: "active",
      subscriptionId: "sub_4",
    });
  });

  it("счёт старого формата тоже находит подписку", async () => {
    const result = await parse({
      id: "evt_8",
      type: "invoice.payment_failed",
      data: {
        object: { id: "in_3", object: "invoice", customer: "cus_5", subscription: "sub_5" },
      },
    });

    expect(result).toMatchObject({ kind: "subscription", subscriptionId: "sub_5" });
  });

  it("счёт без подписки не меняет ничей план", async () => {
    const result = await parse({
      id: "evt_9",
      type: "invoice.payment_failed",
      data: {
        object: { id: "in_4", object: "invoice", customer: "cus_6", billing_reason: "manual" },
      },
    });

    expect(result).toMatchObject({ kind: "ignored", type: "invoice.payment_failed" });
  });

  it("тело без типа события отвергается, даже если подпись своя", async () => {
    const payload = JSON.stringify({ hello: "world" });

    await expect(
      provider({ now: () => now }).parseEvent(payload, await sign(payload, now)),
    ).rejects.toBeInstanceOf(WebhookSignatureError);
  });
});

describe("createCheckout", () => {
  it("отправляет цену плана и метку агентства", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ id: "cs_1", url: "https://checkout.test/cs_1" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
    );

    const session = await provider({
      fetchImpl: fetchImpl as unknown as typeof fetch,
    }).createCheckout({
      agencyId: "agency-uuid",
      plan: "scale",
      email: "owner@agency.test",
      successUrl: "https://app.test/settings/billing?paid=1",
      cancelUrl: "https://app.test/settings/billing",
    });

    expect(session.url).toBe("https://checkout.test/cs_1");

    const [, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    const form = new URLSearchParams(String(init.body));
    expect(form.get("line_items[0][price]")).toBe("price_scale");
    expect(form.get("client_reference_id")).toBe("agency-uuid");
    expect(form.get("subscription_data[metadata][agency_id]")).toBe("agency-uuid");
    expect(form.get("customer_email")).toBe("owner@agency.test");
  });
});

/** Ответы Stripe по форме из их документации — сеть в тестах не трогается. */
function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

const SUBSCRIPTION_FIXTURE = {
  id: "sub_1MowQVLkdIwHu7ixeRlqHVzs",
  object: "subscription",
  cancel_at_period_end: false,
  customer: "cus_Na6dX7aXxi11N4",
  status: "active",
  items: {
    object: "list",
    data: [
      {
        id: "si_Na6dzxczY5fwHx",
        object: "subscription_item",
        current_period_end: 1_682_288_167,
        current_period_start: 1_679_609_767,
        price: { id: "price_growth", object: "price", recurring: { interval: "month" } },
        quantity: 1,
        subscription: "sub_1MowQVLkdIwHu7ixeRlqHVzs",
      },
    ],
    has_more: false,
    total_count: 1,
  },
};

describe("changePlan", () => {
  function calls() {
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) =>
      init?.method === "POST"
        ? jsonResponse({ ...SUBSCRIPTION_FIXTURE, status: "active" })
        : jsonResponse(SUBSCRIPTION_FIXTURE),
    );
    return fetchImpl;
  }

  it("меняет цену в существующей позиции, а не заводит вторую подписку", async () => {
    const fetchImpl = calls();

    await provider({ fetchImpl: fetchImpl as unknown as typeof fetch }).changePlan({
      subscriptionId: "sub_1MowQVLkdIwHu7ixeRlqHVzs",
      plan: "scale",
    });

    const [readUrl, readInit] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(readUrl).toContain("/subscriptions/sub_1MowQVLkdIwHu7ixeRlqHVzs");
    expect(readInit.method).toBe("GET");

    const [writeUrl, writeInit] = fetchImpl.mock.calls[1] as unknown as [string, RequestInit];
    expect(writeUrl).toContain("/subscriptions/sub_1MowQVLkdIwHu7ixeRlqHVzs");
    const form = new URLSearchParams(String(writeInit.body));
    // Идентификатор позиции обязателен: без него Stripe добавит вторую строку.
    expect(form.get("items[0][id]")).toBe("si_Na6dzxczY5fwHx");
    expect(form.get("items[0][price]")).toBe("price_scale");
    expect(form.get("proration_behavior")).toBe("always_invoice");
    // Новый тариф — только после оплаты разницы, а не сразу с просрочкой.
    expect(form.get("payment_behavior")).toBe("pending_if_incomplete");
    // Ни одного запроса на создание новой подписки или нового checkout.
    expect(fetchImpl.mock.calls).toHaveLength(2);
  });

  it("переход на тот же тариф ничего не пересчитывает", async () => {
    const fetchImpl = calls();

    await provider({ fetchImpl: fetchImpl as unknown as typeof fetch }).changePlan({
      subscriptionId: "sub_1MowQVLkdIwHu7ixeRlqHVzs",
      plan: "growth",
    });

    expect(fetchImpl.mock.calls).toHaveLength(1);
  });

  it("отказ Stripe не проглатывается", async () => {
    const fetchImpl = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: { message: "No such subscription" } }), {
          status: 404,
        }),
    );

    await expect(
      provider({ fetchImpl: fetchImpl as unknown as typeof fetch }).changePlan({
        subscriptionId: "sub_gone",
        plan: "scale",
      }),
    ).rejects.toThrow(/404/);
  });
});

describe("setCancelAtPeriodEnd", () => {
  it("отмена и возврат — один запрос с разным значением", async () => {
    const fetchImpl = vi.fn(async (_url: string, _init?: RequestInit) =>
      jsonResponse(SUBSCRIPTION_FIXTURE),
    );
    const payments = provider({ fetchImpl: fetchImpl as unknown as typeof fetch });

    await payments.setCancelAtPeriodEnd({ subscriptionId: "sub_1", cancelAtPeriodEnd: true });
    await payments.setCancelAtPeriodEnd({ subscriptionId: "sub_1", cancelAtPeriodEnd: false });

    const bodies = fetchImpl.mock.calls.map(([, init]) =>
      new URLSearchParams(String(init?.body)).get("cancel_at_period_end"),
    );
    expect(bodies).toEqual(["true", "false"]);
  });
});

describe("InMemoryPaymentEventLedger", () => {
  it("то же событие занимается один раз", async () => {
    const ledger = new InMemoryPaymentEventLedger();
    const at = new Date("2026-09-15T12:00:00.000Z");

    expect(await ledger.claim("evt_1", at)).toEqual({ claimed: true });
    expect(await ledger.claim("evt_1", at)).toMatchObject({ claimed: false });
    expect(await ledger.claim("evt_2", at)).toEqual({ claimed: true });
  });

  it("отпущенное событие можно применить снова", async () => {
    const ledger = new InMemoryPaymentEventLedger();
    const at = new Date("2026-09-15T12:00:00.000Z");

    await ledger.claim("evt_1", at);
    await ledger.release("evt_1");

    expect(await ledger.claim("evt_1", at)).toEqual({ claimed: true });
  });

  it("журнал не растёт бесконечно", async () => {
    const ledger = new InMemoryPaymentEventLedger(2);
    const at = new Date("2026-09-15T12:00:00.000Z");

    await ledger.claim("evt_1", at);
    await ledger.claim("evt_2", at);
    await ledger.claim("evt_3", at);

    // Самое старое вытеснено — зато свежие повторы по-прежнему отсекаются.
    expect(await ledger.claim("evt_3", at)).toMatchObject({ claimed: false });
    expect(await ledger.claim("evt_1", at)).toEqual({ claimed: true });
  });
});

describe("createPaymentProvider", () => {
  it("без ключа продукт не притворяется, что принимает оплату", async () => {
    const payments = createPaymentProvider({});

    expect(payments).toBeInstanceOf(UnconfiguredPaymentProvider);
    expect(payments.configured).toBe(false);
    await expect(payments.createCheckout({} as never)).rejects.toBeInstanceOf(
      PaymentsNotConfiguredError,
    );
  });

  it("без ключа ни один путь оплаты не падает при импорте и не делает вид, что сработал", async () => {
    // Импорт уже случился — модуль не читает env на верхнем уровне.
    const payments = createPaymentProvider({ ADAPTERS_MODE: "mock" });

    expect(payments.configured).toBe(false);
    for (const attempt of [
      () => payments.createPortal({} as never),
      () => payments.changePlan({} as never),
      () => payments.setCancelAtPeriodEnd({} as never),
      () => payments.parseEvent("{}", "t=1,v1=x"),
    ]) {
      await expect(attempt()).rejects.toBeInstanceOf(PaymentsNotConfiguredError);
    }
  });

  it("ключ без секрета вебхука — ошибка, а не доверчивый режим", () => {
    expect(() => createPaymentProvider({ STRIPE_SECRET_KEY: "sk_test" })).toThrow(
      /STRIPE_WEBHOOK_SECRET/,
    );
  });

  it("настроенная половина планов отвергается", () => {
    expect(() =>
      createPaymentProvider({
        STRIPE_SECRET_KEY: "sk_test",
        STRIPE_WEBHOOK_SECRET: "whsec",
        STRIPE_PRICE_STARTER: "price_starter",
      }),
    ).toThrow(/growth, scale/);
  });

  it("полный набор ключей даёт живого провайдера", () => {
    const payments = createPaymentProvider({
      STRIPE_SECRET_KEY: "sk_test",
      STRIPE_WEBHOOK_SECRET: "whsec",
      STRIPE_PRICE_STARTER: "price_starter",
      STRIPE_PRICE_GROWTH: "price_growth",
      STRIPE_PRICE_SCALE: "price_scale",
    });

    expect(payments.configured).toBe(true);
  });
});
