import type { PlanId, SubscriptionStatus } from "./entitlements";
import type {
  CancelInput,
  ChangePlanInput,
  CheckoutInput,
  CheckoutSession,
  PaymentEvent,
  PaymentEventEnvelope,
  PaymentProvider,
  PortalInput,
  SubscriptionField,
} from "./payments";
import { hmacSha256Hex, timingSafeEqual, WebhookSignatureError } from "./stripe";

/**
 * Живой платёжный провайдер — Creem (Merchant of Record).
 *
 * Продавец перед покупателем — Creem: он принимает деньги, считает налоги и
 * выплачивает нам. Обмен — JSON через `fetch`, без SDK: сборка герметична,
 * а подпись вебхука проверяется WebCrypto, как у Stripe.
 *
 * Ключ сам говорит, куда ходить: тестовые начинаются с `creem_test_` и
 * работают только с тестовым API — перепутать песочницу с живыми деньгами
 * настройкой нельзя.
 */

const LIVE_API = "https://api.creem.io/v1";
const TEST_API = "https://test-api.creem.io/v1";

export interface CreemProducts {
  starter: string;
  growth: string;
  scale: string;
}

export interface CreemPaymentProviderConfig {
  apiKey: string;
  webhookSecret: string;
  products: CreemProducts;
  endpoint?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
}

/**
 * Статусы подписки Creem в наших терминах.
 *
 * `scheduled_cancel` — подписка ещё оплачена и работает до конца периода.
 * `unpaid` — та же просрочка, что `past_due`. Пауза и истечение доступа не
 * дают: платить за паузу никто не будет, а работать мы будем за свой счёт.
 */
const STATUS_MAP: Record<string, SubscriptionStatus> = {
  active: "active",
  trialing: "trialing",
  scheduled_cancel: "active",
  past_due: "past_due",
  unpaid: "past_due",
  paused: "canceled",
  canceled: "canceled",
  expired: "canceled",
};

const UNKNOWN_EXCEPT_STATUS: readonly SubscriptionField[] = [
  "plan",
  "currentPeriodEnd",
  "cancelAtPeriodEnd",
];

export class CreemPaymentProvider implements PaymentProvider {
  readonly configured = true;

  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;
  private readonly now: () => Date;
  private readonly planByProduct: Map<string, PlanId>;

  constructor(private readonly config: CreemPaymentProviderConfig) {
    if (!config.apiKey) {
      throw new Error("CREEM_API_KEY is not set.");
    }
    if (!config.webhookSecret) {
      // Без секрета вебхука любой желающий мог бы выдать себе план.
      throw new Error("CREEM_WEBHOOK_SECRET is not set; webhooks cannot be trusted without it.");
    }

    this.endpoint =
      config.endpoint ?? (config.apiKey.startsWith("creem_test_") ? TEST_API : LIVE_API);
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.now = config.now ?? (() => new Date());
    this.planByProduct = new Map(
      (Object.entries(config.products) as [PlanId, string][])
        .filter(([, product]) => Boolean(product))
        .map(([plan, product]) => [product, plan]),
    );
  }

  async createCheckout(input: CheckoutInput): Promise<CheckoutSession> {
    const productId = this.config.products[input.plan];
    if (!productId) {
      throw new Error(`No Creem product configured for the ${input.plan} plan.`);
    }

    // Агентство — в метаданных, которые Creem переносит в подписку: по любому
    // следующему событию понятно, чьи это деньги, а покупатель поменять их
    // не может — сессия создаётся здесь, на сервере.
    const session = await this.request<{ id: string; checkout_url?: string }>("/checkouts", {
      product_id: productId,
      request_id: input.agencyId,
      success_url: input.successUrl,
      metadata: { agency_id: input.agencyId },
      customer: input.customerId ? { id: input.customerId } : { email: input.email },
    });
    if (!session.checkout_url) {
      throw new Error("Creem created a checkout without a URL.");
    }

    return { url: session.checkout_url, sessionId: session.id };
  }

  async createPortal(input: PortalInput): Promise<{ url: string }> {
    const links = await this.request<{ customer_portal_link: string }>("/customers/billing", {
      customer_id: input.customerId,
    });
    return { url: links.customer_portal_link };
  }

  /**
   * Смена тарифа — в той же подписке. Разница списывается сразу
   * (`proration-charge-immediately`): повышение открывает тариф сегодня, и
   * платить за него надо сегодня, а не через месяц.
   */
  async changePlan(input: ChangePlanInput): Promise<void> {
    const productId = this.config.products[input.plan];
    if (!productId) {
      throw new Error(`No Creem product configured for the ${input.plan} plan.`);
    }
    await this.request(`/subscriptions/${encodeURIComponent(input.subscriptionId)}/upgrade`, {
      product_id: productId,
      update_behavior: "proration-charge-immediately",
    });
  }

  /** Отмена в конце оплаченного периода — `scheduled`; возврат — отдельный вызов. */
  async setCancelAtPeriodEnd(input: CancelInput): Promise<void> {
    const id = encodeURIComponent(input.subscriptionId);
    if (input.cancelAtPeriodEnd) {
      await this.request(`/subscriptions/${id}/cancel`, { mode: "scheduled", onExecute: "cancel" });
    } else {
      await this.request(`/subscriptions/${id}/resume`, {});
    }
  }

  /**
   * Подпись Creem — HMAC-SHA256 сырого тела секретом вебхука, в заголовке
   * `creem-signature`. Метки времени в подписи нет: повтор старого события
   * отсекает журнал событий по идентификатору, а не окно по времени.
   */
  async parseEvent(payload: string, signature: string): Promise<PaymentEventEnvelope> {
    const provided = signature.trim().toLowerCase();
    if (!provided) {
      throw new WebhookSignatureError("The creem-signature header is missing.");
    }
    const expected = await hmacSha256Hex(this.config.webhookSecret, payload);
    if (!timingSafeEqual(expected, provided)) {
      throw new WebhookSignatureError("creem-signature does not match the payload.");
    }

    const event = JSON.parse(payload) as CreemEvent;
    if (!event.id || !event.eventType) {
      throw new WebhookSignatureError("The webhook body is not a Creem event.");
    }

    return {
      eventId: event.id,
      type: event.eventType,
      // `created_at` у Creem — в миллисекундах.
      occurredAt: typeof event.created_at === "number" ? new Date(event.created_at) : this.now(),
      event: this.translate(event),
    };
  }

  private translate(event: CreemEvent): PaymentEvent {
    const object = event.object ?? {};

    switch (event.eventType) {
      case "checkout.completed": {
        const subscription = object.subscription as CreemSubscription | undefined;
        if (!subscription) {
          return { kind: "ignored", type: event.eventType, reason: "Not a subscription purchase." };
        }
        const productId = idOf(object.product) ?? idOf(subscription.product);
        return {
          kind: "subscription",
          agencyId: metadataAgency(object.metadata) ?? metadataAgency(subscription.metadata),
          customerId: idOf(object.customer) ?? idOf(subscription.customer) ?? "",
          subscriptionId: subscription.id ?? null,
          plan: this.planOf(productId),
          status: STATUS_MAP[subscription.status ?? "active"] ?? "active",
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          unknownFields: [
            ...(this.planOf(productId) ? [] : (["plan"] as SubscriptionField[])),
            "currentPeriodEnd",
          ],
        };
      }

      case "subscription.active":
      case "subscription.paid":
      case "subscription.update":
      case "subscription.trialing":
      case "subscription.scheduled_cancel":
      case "subscription.past_due":
      case "subscription.unpaid":
      case "subscription.paused":
      case "subscription.canceled":
      case "subscription.expired": {
        const subscription = object as CreemSubscription;
        const productId = idOf(subscription.product);
        const plan = this.planOf(productId);
        const periodEnd = subscription.current_period_end_date
          ? new Date(subscription.current_period_end_date)
          : null;
        const status =
          event.eventType === "subscription.scheduled_cancel"
            ? "scheduled_cancel"
            : (subscription.status ?? event.eventType.split(".")[1] ?? "");
        return {
          kind: "subscription",
          agencyId: metadataAgency(subscription.metadata),
          customerId: idOf(subscription.customer) ?? "",
          subscriptionId: subscription.id ?? null,
          plan,
          status: STATUS_MAP[status] ?? "incomplete",
          currentPeriodEnd: periodEnd,
          cancelAtPeriodEnd: status === "scheduled_cancel",
          // Незнакомый продукт не должен перевести агентство на starter.
          unknownFields: [
            ...(plan ? [] : (["plan"] as SubscriptionField[])),
            ...(periodEnd ? [] : (["currentPeriodEnd"] as SubscriptionField[])),
          ],
        };
      }

      /**
       * Полный возврат и спор по карте закрывают доступ: иначе «оплатить и
       * вернуть деньги» оставляло тариф до конца периода — с нашими
       * расходами на ответы. Частичный возврат — скидка, доступ остаётся.
       */
      case "refund.created":
      case "dispute.created": {
        const transaction = (object.transaction ?? {}) as CreemTransaction;
        const subscription = object.subscription as CreemSubscription | undefined;
        const fullRefund =
          event.eventType === "dispute.created" ||
          (typeof object.refund_amount === "number" &&
            typeof transaction.amount_paid === "number" &&
            object.refund_amount >= transaction.amount_paid);
        const customerId = idOf(transaction.customer) ?? idOf(subscription?.customer);
        if (!fullRefund || !customerId) {
          return {
            kind: "ignored",
            type: event.eventType,
            reason: "A partial refund keeps the plan.",
          };
        }
        return {
          kind: "subscription",
          agencyId: metadataAgency(subscription?.metadata),
          customerId,
          subscriptionId: subscription?.id ?? idOf(transaction.subscription) ?? null,
          plan: null,
          status: "canceled",
          currentPeriodEnd: null,
          cancelAtPeriodEnd: false,
          unknownFields: UNKNOWN_EXCEPT_STATUS,
        };
      }

      default:
        return {
          kind: "ignored",
          type: event.eventType,
          reason: "The product only reacts to checkout, subscription, refund and dispute events.",
        };
    }
  }

  private planOf(productId: string | null): PlanId | null {
    return productId ? (this.planByProduct.get(productId) ?? null) : null;
  }

  private async request<T>(path: string, body: unknown): Promise<T> {
    const response = await this.fetchImpl(`${this.endpoint}${path}`, {
      method: "POST",
      headers: { "x-api-key": this.config.apiKey, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Creem responded ${response.status}: ${text.slice(0, 500)}`);
    }
    return (await response.json()) as T;
  }
}

/** У Creem ссылка на объект — то строка-идентификатор, то сам объект. */
function idOf(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string") {
    return (value as { id: string }).id;
  }
  return null;
}

function metadataAgency(metadata: unknown): string | null {
  const value = (metadata as { agency_id?: unknown } | null | undefined)?.agency_id;
  return typeof value === "string" && value ? value : null;
}

interface CreemEvent {
  id: string;
  eventType: string;
  created_at?: number;
  object?: Record<string, unknown> & {
    metadata?: unknown;
    product?: unknown;
    customer?: unknown;
    subscription?: unknown;
    transaction?: unknown;
    refund_amount?: number;
  };
}

interface CreemSubscription {
  id?: string;
  product?: unknown;
  customer?: unknown;
  status?: string;
  current_period_end_date?: string;
  metadata?: unknown;
}

interface CreemTransaction {
  amount_paid?: number;
  customer?: unknown;
  subscription?: unknown;
}
