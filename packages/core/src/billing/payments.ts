import type { PlanId, SubscriptionStatus } from "./entitlements";

/**
 * Приём денег — за интерфейсом, как и всё внешнее в этом пакете.
 *
 * Продукт обязан работать без платёжного провайдера: агентство заводит
 * клиентов и меряет видимость на starter-лимитах, а недоступный биллинг
 * не должен превращаться в недоступный продукт.
 */

export interface CheckoutInput {
  agencyId: string;
  plan: PlanId;
  email: string;
  successUrl: string;
  cancelUrl: string;
  /** Уже известный плательщик: без него провайдер заведёт второго. */
  customerId?: string;
}

export interface CheckoutSession {
  url: string;
  sessionId: string;
}

export interface PortalInput {
  customerId: string;
  returnUrl: string;
}

/**
 * Переход между тарифами у уже платящего агентства.
 *
 * Отдельно от checkout намеренно: второй checkout заводит вторую подписку,
 * и агентство начинает платить дважды за один продукт. Смена тарифа — это
 * правка цены в уже существующей подписке.
 */
export interface ChangePlanInput {
  subscriptionId: string;
  plan: PlanId;
}

export interface CancelInput {
  subscriptionId: string;
  /** `true` — доработать оплаченный период, `false` — вернуть подписку в строй. */
  cancelAtPeriodEnd: boolean;
}

/** Слепок подписки из события провайдера — то, что нужно записать в базу. */
export interface SubscriptionChange {
  kind: "subscription";
  /** Агентство берётся из метаданных сессии: чужую подписку записать нельзя. */
  agencyId: string | null;
  customerId: string;
  subscriptionId: string | null;
  plan: PlanId | null;
  status: SubscriptionStatus;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  /**
   * Поля, о которых событие ничего не говорит.
   *
   * Счёт не знает ни тарифа, ни конца периода, и записать по нему `null`
   * значит стереть срок, по которому считается отсрочка при сбое платежа.
   * Тот, кто пишет в базу, обязан оставить эти поля как есть.
   *
   * Необязательное: событие, которое знает всё, ничего не перечисляет.
   */
  unknownFields?: readonly SubscriptionField[];
}

export type SubscriptionField = "plan" | "currentPeriodEnd" | "cancelAtPeriodEnd";

/** Событие, которое продукт сознательно не обрабатывает. */
export interface IgnoredEvent {
  kind: "ignored";
  type: string;
  reason: string;
}

export type PaymentEvent = SubscriptionChange | IgnoredEvent;

/**
 * Конверт события провайдера.
 *
 * Идентификатор и время лежат снаружи разобранного события: применить
 * событие ровно один раз нужно независимо от того, что в нём написано, — и
 * событие, которое продукт игнорирует, тоже должно быть отмечено как
 * доставленное.
 */
export interface PaymentEventEnvelope {
  eventId: string;
  type: string;
  occurredAt: Date;
  event: PaymentEvent;
}

/**
 * Провайдер оплаты. Обязательства любой реализации — их нарушение стоит
 * денег, и проверил их аудит безопасности:
 *
 * - вебхук проверяется подписью по сырому телу и окну времени до разбора;
 * - повышение тарифа применяется только после оплаты разницы, а не сразу
 *   с переходом в просрочку при отказе карты;
 * - полный возврат денег и спор по карте приходят событием со статусом
 *   `canceled` и плательщиком — доступ закрывается;
 * - сессия оплаты создаётся на сервере, агентство — в её метаданных, а не в
 *   параметрах ссылки, которые может поменять покупатель;
 * - пробный период не считается оплатой без лимита.
 */
export interface PaymentProvider {
  /** Настроен ли приём денег. Интерфейс не должен показывать кнопку, которая не сработает. */
  readonly configured: boolean;
  createCheckout(input: CheckoutInput): Promise<CheckoutSession>;
  createPortal(input: PortalInput): Promise<{ url: string }>;
  /** Переводит подписку на другой тариф, не заводя вторую. */
  changePlan(input: ChangePlanInput): Promise<void>;
  /** Отмена в конце оплаченного периода и возврат из неё. */
  setCancelAtPeriodEnd(input: CancelInput): Promise<void>;
  /** Проверяет подпись и переводит событие провайдера в наши термины. */
  parseEvent(payload: string, signature: string): Promise<PaymentEventEnvelope>;
}

export type EventClaim = { claimed: true } | { claimed: false; reason: string };

/**
 * Журнал обработанных событий.
 *
 * Провайдер доставляет событие «хотя бы один раз»: повтор после таймаута
 * или после нашего 500 — это штатная работа Stripe, а не сбой. Применённое
 * дважды событие второй раз меняет тариф и второй раз шлёт письмо, поэтому
 * событие занимается по идентификатору до того, как что-то записано.
 *
 * За интерфейсом, потому что в одном процессе достаточно памяти, а в
 * нескольких — нужна общая таблица, и выбор не должен менять код вебхука.
 */
export interface PaymentEventLedger {
  /** Занимает событие. `claimed: false` — оно уже обработано, повторять нечего. */
  claim(eventId: string, occurredAt: Date): Promise<EventClaim>;
  /**
   * Отпускает событие, которое применить не удалось.
   *
   * Без этого сбой базы превращался бы в потерянное событие: провайдер
   * повторит доставку, а журнал скажет, что всё уже сделано.
   */
  release(eventId: string): Promise<void>;
}

/**
 * Журнал в памяти — умолчание.
 *
 * Держит один процесс честным и не требует схемы. Переживает перезапуск
 * ровно никак: на нескольких экземплярах нужен общий журнал в базе.
 */
export class InMemoryPaymentEventLedger implements PaymentEventLedger {
  private readonly seen = new Map<string, Date>();

  constructor(private readonly capacity = 5_000) {}

  claim(eventId: string, occurredAt: Date): Promise<EventClaim> {
    if (this.seen.has(eventId)) {
      return Promise.resolve({ claimed: false, reason: "The event was already processed." });
    }

    this.seen.set(eventId, occurredAt);
    // Журнал не должен расти вечно: события старше нескольких тысяч
    // провайдер уже не повторит.
    while (this.seen.size > this.capacity) {
      const oldest = this.seen.keys().next();
      if (oldest.done) {
        break;
      }
      this.seen.delete(oldest.value);
    }

    return Promise.resolve({ claimed: true });
  }

  release(eventId: string): Promise<void> {
    this.seen.delete(eventId);
    return Promise.resolve();
  }
}

export class PaymentsNotConfiguredError extends Error {
  constructor() {
    super(
      "Payments are not configured. Set STRIPE_SECRET_KEY and the plan price IDs to accept subscriptions.",
    );
    this.name = "PaymentsNotConfiguredError";
  }
}

/**
 * Провайдер по умолчанию: денег не берёт и не притворяется, что берёт.
 *
 * Никакой имитации оплаты: фальшивый checkout, который «проводит» платёж,
 * однажды доедет до продакшена и выдаст бесплатный доступ за настоящий.
 */
export class UnconfiguredPaymentProvider implements PaymentProvider {
  readonly configured = false;

  createCheckout(): Promise<CheckoutSession> {
    return Promise.reject(new PaymentsNotConfiguredError());
  }

  createPortal(): Promise<{ url: string }> {
    return Promise.reject(new PaymentsNotConfiguredError());
  }

  changePlan(): Promise<void> {
    return Promise.reject(new PaymentsNotConfiguredError());
  }

  setCancelAtPeriodEnd(): Promise<void> {
    return Promise.reject(new PaymentsNotConfiguredError());
  }

  parseEvent(): Promise<PaymentEventEnvelope> {
    return Promise.reject(new PaymentsNotConfiguredError());
  }
}
