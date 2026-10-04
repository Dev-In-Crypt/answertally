import { describe, expect, it, vi } from "vitest";
import { CreemPaymentProvider } from "./creem";
import { createPaymentProvider } from "./provider";
import { hmacSha256Hex, WebhookSignatureError } from "./stripe";

const SECRET = "whsec_test_secret";
const PRODUCTS = { starter: "prod_starter", growth: "prod_growth", scale: "prod_scale" };

function provider(fetchImpl?: ReturnType<typeof vi.fn>, apiKey = "creem_test_key") {
  return new CreemPaymentProvider({
    apiKey,
    webhookSecret: SECRET,
    products: PRODUCTS,
    ...(fetchImpl ? { fetchImpl: fetchImpl as unknown as typeof fetch } : {}),
  });
}

function jsonResponse(body: unknown) {
  return vi.fn(() => Promise.resolve(new Response(JSON.stringify(body), { status: 200 })));
}

async function parse(event: unknown) {
  const payload = JSON.stringify(event);
  return provider().parseEvent(payload, await hmacSha256Hex(SECRET, payload));
}

const subscription = (patch: Record<string, unknown> = {}) => ({
  id: "sub_1",
  object: "subscription",
  product: { id: "prod_growth" },
  customer: { id: "cust_1" },
  status: "active",
  current_period_end_date: "2026-11-04T00:00:00.000Z",
  metadata: { agency_id: "agency-1" },
  ...patch,
});

describe("CreemPaymentProvider — вебхук", () => {
  it("своя подпись проходит, чужая и подменённое тело — нет", async () => {
    const payload = JSON.stringify({
      id: "evt_1",
      eventType: "subscription.paid",
      object: subscription(),
    });
    const good = await hmacSha256Hex(SECRET, payload);

    await expect(provider().parseEvent(payload, good)).resolves.toMatchObject({ eventId: "evt_1" });
    await expect(
      provider().parseEvent(payload, await hmacSha256Hex("other", payload)),
    ).rejects.toThrow(WebhookSignatureError);
    await expect(
      provider().parseEvent(payload.replace("agency-1", "agency-2"), good),
    ).rejects.toThrow(WebhookSignatureError);
    await expect(provider().parseEvent(payload, "")).rejects.toThrow(WebhookSignatureError);
  });

  it("оплата подписки даёт тариф, агентство из метаданных и конец периода", async () => {
    const envelope = await parse({
      id: "evt_2",
      eventType: "subscription.paid",
      created_at: 1791100000000,
      object: subscription(),
    });

    expect(envelope.occurredAt.getTime()).toBe(1791100000000);
    expect(envelope.event).toMatchObject({
      kind: "subscription",
      agencyId: "agency-1",
      customerId: "cust_1",
      subscriptionId: "sub_1",
      plan: "growth",
      status: "active",
      cancelAtPeriodEnd: false,
    });
  });

  it("отмена в конце периода — ещё действующая подписка с отметкой", async () => {
    const { event } = await parse({
      id: "evt_3",
      eventType: "subscription.scheduled_cancel",
      object: subscription({ status: "active" }),
    });
    expect(event).toMatchObject({ status: "active", cancelAtPeriodEnd: true });
  });

  it("просрочка, неоплата, пауза и истечение переводятся в наши статусы", async () => {
    const cases: [string, string, string][] = [
      ["subscription.past_due", "past_due", "past_due"],
      ["subscription.unpaid", "unpaid", "past_due"],
      ["subscription.paused", "paused", "canceled"],
      ["subscription.expired", "expired", "canceled"],
      ["subscription.canceled", "canceled", "canceled"],
    ];
    for (const [type, status, expected] of cases) {
      const { event } = await parse({
        id: `evt_${type}`,
        eventType: type,
        object: subscription({ status }),
      });
      expect(event).toMatchObject({ status: expected });
    }
  });

  it("незнакомый продукт тариф не трогает", async () => {
    const { event } = await parse({
      id: "evt_4",
      eventType: "subscription.paid",
      object: subscription({ product: { id: "prod_unknown" } }),
    });
    expect(event).toMatchObject({ plan: null, unknownFields: ["plan"] });
  });

  it("полный возврат и спор закрывают доступ, частичный возврат — нет", async () => {
    const transaction = { amount_paid: 49900, customer: "cust_1", subscription: "sub_1" };
    const full = await parse({
      id: "evt_5",
      eventType: "refund.created",
      object: {
        refund_amount: 49900,
        transaction,
        subscription: { id: "sub_1", customer: "cust_1" },
      },
    });
    expect(full.event).toMatchObject({
      kind: "subscription",
      status: "canceled",
      customerId: "cust_1",
    });

    const partial = await parse({
      id: "evt_6",
      eventType: "refund.created",
      object: {
        refund_amount: 1000,
        transaction,
        subscription: { id: "sub_1", customer: "cust_1" },
      },
    });
    expect(partial.event).toMatchObject({ kind: "ignored" });

    const dispute = await parse({
      id: "evt_7",
      eventType: "dispute.created",
      object: { transaction },
    });
    expect(dispute.event).toMatchObject({
      kind: "subscription",
      status: "canceled",
      subscriptionId: "sub_1",
    });
  });

  it("завершённая оплата привязывает агентство и подписку", async () => {
    const { event } = await parse({
      id: "evt_8",
      eventType: "checkout.completed",
      object: {
        product: { id: "prod_starter" },
        customer: { id: "cust_2" },
        metadata: { agency_id: "agency-2" },
        subscription: { id: "sub_2", status: "active", metadata: { agency_id: "agency-2" } },
      },
    });
    expect(event).toMatchObject({
      agencyId: "agency-2",
      customerId: "cust_2",
      subscriptionId: "sub_2",
      plan: "starter",
    });
  });
});

describe("CreemPaymentProvider — запросы", () => {
  it("тестовый ключ ходит в тестовый API, оплата создаётся на сервере с агентством в метаданных", async () => {
    const fetchImpl = jsonResponse({ id: "ch_1", checkout_url: "https://checkout.creem.io/ch_1" });

    const session = await provider(fetchImpl).createCheckout({
      agencyId: "agency-1",
      plan: "scale",
      email: "owner@agency.test",
      successUrl: "https://answertally.com/settings/billing?checkout=done",
      cancelUrl: "https://answertally.com/settings/billing",
    });

    expect(session.url).toBe("https://checkout.creem.io/ch_1");
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://test-api.creem.io/v1/checkouts");
    expect((init.headers as Record<string, string>)["x-api-key"]).toBe("creem_test_key");
    expect(JSON.parse(init.body as string)).toMatchObject({
      product_id: "prod_scale",
      metadata: { agency_id: "agency-1" },
      customer: { email: "owner@agency.test" },
    });
  });

  it("живой ключ ходит в боевой API", async () => {
    const fetchImpl = jsonResponse({ customer_portal_link: "https://creem.io/portal/x" });
    await provider(fetchImpl, "creem_live_key").createPortal({
      customerId: "cust_1",
      returnUrl: "x",
    });
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe(
      "https://api.creem.io/v1/customers/billing",
    );
  });

  it("смена тарифа и отмена — в той же подписке", async () => {
    const fetchImpl = jsonResponse({});
    await provider(fetchImpl).changePlan({ subscriptionId: "sub_1", plan: "growth" });
    await provider(fetchImpl).setCancelAtPeriodEnd({
      subscriptionId: "sub_1",
      cancelAtPeriodEnd: true,
    });
    await provider(fetchImpl).setCancelAtPeriodEnd({
      subscriptionId: "sub_1",
      cancelAtPeriodEnd: false,
    });

    const calls = fetchImpl.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0]![0]).toMatch(/\/subscriptions\/sub_1\/upgrade$/);
    expect(JSON.parse(calls[0]![1].body as string)).toMatchObject({ product_id: "prod_growth" });
    expect(calls[1]![0]).toMatch(/\/subscriptions\/sub_1\/cancel$/);
    expect(JSON.parse(calls[1]![1].body as string)).toMatchObject({ mode: "scheduled" });
    expect(calls[2]![0]).toMatch(/\/subscriptions\/sub_1\/resume$/);
  });
});

describe("выбор провайдера", () => {
  it("ключ Creem без секрета или продуктов — понятная ошибка, а не доверчивый режим", () => {
    expect(() => createPaymentProvider({ CREEM_API_KEY: "creem_test_x" })).toThrow(
      /CREEM_WEBHOOK_SECRET/,
    );
    expect(() =>
      createPaymentProvider({ CREEM_API_KEY: "creem_test_x", CREEM_WEBHOOK_SECRET: "s" }),
    ).toThrow(/product IDs/);
  });

  it("полный набор ключей Creem даёт Creem", () => {
    const chosen = createPaymentProvider({
      CREEM_API_KEY: "creem_test_x",
      CREEM_WEBHOOK_SECRET: "s",
      CREEM_PRODUCT_STARTER: "a",
      CREEM_PRODUCT_GROWTH: "b",
      CREEM_PRODUCT_SCALE: "c",
    });
    expect(chosen).toBeInstanceOf(CreemPaymentProvider);
  });
});
