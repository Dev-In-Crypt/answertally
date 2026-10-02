import { PLAN_LIMITS, type PlanLimits } from "./period";

/**
 * Что агентству разрешено прямо сейчас.
 *
 * Считается из подписки, а не из полей агентства: поля — производные, их
 * обновляет вебхук, и рассинхрон между «что записано» и «за что заплачено»
 * должен разрешаться в пользу подписки.
 *
 * Чистая функция без обращений к провайдеру: решение о доступе принимается
 * даже когда провайдер недоступен.
 */

export type PlanId = keyof typeof PLAN_LIMITS;

export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "canceled"
  | "incomplete";

export interface SubscriptionSnapshot {
  plan: PlanId;
  status: SubscriptionStatus;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  /**
   * Клиентские аккаунты сверх тарифа, купленные по оптовой цене.
   *
   * Отдельным числом, а не поднятым вручную лимитом у агентства: лимит там
   * производный, его переписывает каждое событие подписки, и однажды
   * агентство с сорока клиентами проснулось бы с потолком в двадцать пять.
   * Условия — `billing/partner.ts`.
   */
  extraClientAccounts?: number;
}

export interface Entitlements extends PlanLimits {
  plan: PlanId;
  /** Работает ли продукт: измерения, отчёты, новые клиенты. */
  active: boolean;
  /**
   * Платит ли агентство за тариф прямо сейчас.
   *
   * Отдельно от `active`, потому что это разные вопросы. Только что
   * зарегистрировавшееся агентство работает (`active`), но ещё не заплатило
   * ни разу — и обещание «перерасход ничего не отключает посреди месяца»
   * дано плательщику, а не ему.
   */
  paying: boolean;
  /** Почему так — строка для интерфейса, не код ошибки. */
  reason: string;
}

/**
 * План без подписки.
 *
 * Агентство, которое только зарегистрировалось, работает на starter: продукт
 * бесполезно оценивать, не заведя клиента, а требовать карту до первого
 * измерения — верный способ не получить ни одного агентства.
 */
export const DEFAULT_PLAN: PlanId = "starter";

/**
 * Сколько дней после сбоя платежа агентство продолжает работать.
 *
 * Отключать в день неудачного списания нельзя: у карты кончился срок,
 * банк отклонил разовый платёж — это не отказ от продукта. Клиентские
 * отчёты в это время должны продолжать открываться.
 */
export const PAST_DUE_GRACE_DAYS = 14;

export function entitlementsFor(
  subscription: SubscriptionSnapshot | null,
  now: Date = new Date(),
): Entitlements {
  if (!subscription) {
    return {
      plan: DEFAULT_PLAN,
      ...PLAN_LIMITS[DEFAULT_PLAN],
      active: true,
      paying: false,
      reason: "No subscription yet — the starter limits apply.",
    };
  }

  /**
   * Докупленные аккаунты прибавляются к вместимости тарифа.
   *
   * Только пока агентство платит: в отменённой подписке их нет, потому что
   * нет и платежа за них. Отрицательное число трактуется как ноль — лимит,
   * уменьшенный опечаткой в служебном поле, отрезал бы агентству клиентов.
   */
  const extra = Math.max(0, subscription.extraClientAccounts ?? 0);
  const planLimits = PLAN_LIMITS[subscription.plan];
  const limits = { ...planLimits, clientLimit: planLimits.clientLimit + extra };

  switch (subscription.status) {
    case "active":
    case "trialing":
      return {
        plan: subscription.plan,
        ...limits,
        active: true,
        paying: true,
        reason: subscription.cancelAtPeriodEnd
          ? "Subscription ends at the close of the current period."
          : "Subscription is active.",
      };

    case "past_due": {
      // Пустой конец оплаченного периода — это отсутствие отсрочки, а не
      // бесконечная отсрочка: отсчитывать её не от чего. Трактовать пустоту
      // в пользу доступа значит выдать бессрочную бесплатную работу тому, у
      // кого платёж не прошёл, а оплаченного периода в базе нет.
      const deadline = subscription.currentPeriodEnd
        ? new Date(subscription.currentPeriodEnd.getTime() + PAST_DUE_GRACE_DAYS * 86_400_000)
        : null;
      const withinGrace = deadline !== null && now.getTime() <= deadline.getTime();

      return {
        plan: subscription.plan,
        ...limits,
        active: withinGrace,
        // Просрочка в пределах отсрочки — это ещё плательщик: у него не
        // прошло списание, а не кончились отношения.
        paying: withinGrace,
        reason: withinGrace
          ? "A payment did not go through. Update the card to keep the account running."
          : deadline === null
            ? "A payment did not go through and no paid period is on record. Update the card to restore the account."
            : "The account is suspended after an unpaid period.",
      };
    }

    case "canceled":
    case "incomplete":
      return {
        plan: DEFAULT_PLAN,
        ...PLAN_LIMITS[DEFAULT_PLAN],
        active: false,
        paying: false,
        reason:
          subscription.status === "canceled"
            ? "The subscription was cancelled."
            : "Checkout was never completed.",
      };
  }
}

export interface LimitDecision {
  allowed: boolean;
  /** Текст для интерфейса: человек должен понять, что делать дальше. */
  message: string;
}

/** Можно ли завести ещё одного клиента на текущем плане. */
export function canAddClient(entitlements: Entitlements, currentClients: number): LimitDecision {
  if (!entitlements.active) {
    return { allowed: false, message: entitlements.reason };
  }

  if (currentClients >= entitlements.clientLimit) {
    return {
      allowed: false,
      message: `The ${entitlements.plan} plan covers ${entitlements.clientLimit} clients. Upgrade to add more.`,
    };
  }

  return { allowed: true, message: "" };
}

/**
 * Можно ли перейти на тариф, который держит меньше клиентов, чем заведено.
 *
 * Отказ, а не предупреждение: иначе агентство оказывается в состоянии, для
 * которого у продукта нет честного поведения. Отключить чужих клиентов за
 * понижение тарифа нельзя — это данные, за которые агентство отвечает перед
 * своими; оставить их всех работать значит отдавать больше, чем куплено.
 * Поэтому решает человек, и решает до оплаты, а не после.
 *
 * Отказ называет число: «убрать лишних» без цифры — это задача без условия.
 */
export function canSwitchToPlan(
  target: { plan: PlanId; clientLimit: number },
  currentClients: number,
): LimitDecision {
  if (currentClients <= target.clientLimit) {
    return { allowed: true, message: "" };
  }

  const extra = currentClients - target.clientLimit;
  return {
    allowed: false,
    message: `The ${target.plan} plan covers ${target.clientLimit} clients and you have ${currentClients}. Archive ${extra} ${extra === 1 ? "client" : "clients"} first — switching would not remove them, and we will not measure more clients than the plan covers.`,
  };
}

/**
 * Сколько проверок агентство получает до первой оплаты.
 *
 * Бесплатный аудит — главный вход в продукт. Без этой границы бесплатный
 * аккаунт мог измерять бесконечно: месячный лимит тарифа нигде не
 * проверялся, он только показывался на экране.
 *
 * Число — решение фаундера. Цен и лимитов тарифов оно не касается: до
 * оплаты тарифа ещё нет.
 *
 * **Нижняя граница не произвольная.** Прогон начинается целиком или не
 * начинается вовсе, поэтому значение меньше одного аудита означает, что
 * первый же бесплатный аудит упрётся в отказ.
 *
 * Считать удобнее в вопросах, а не в аудитах: один вопрос стоит
 * `MIN_SAMPLES_PER_CELL` (3) сэмпла × число ассистентов бесплатного аудита
 * (2) = 6 ответов. Отсюда 250 покрывают до 41 вопроса, а
 * `DEFAULT_GENERATED_PROMPT_COUNT` (24) обходится в 144.
 *
 * Запас в сотню ответов появился не решением, а тем, что из бесплатного
 * аудита убрали Grok: ассистентов стало двое вместо троих, и тот же лимит
 * растянулся. Он покрывает либо аудит с набором вопросов шире обычного,
 * либо второй аудит вопросов на семнадцать. Полноценный второй аудит на
 * умолчании в него не помещается.
 */
export const FREE_CHECK_ALLOWANCE = 250;

/**
 * Можно ли начать измерение: хватает ли того, что осталось.
 *
 * Плательщику не отказываем никогда. Перерасход тарифа — это разговор в
 * конце месяца, а не отключение посреди работы: так обещано и на странице
 * тарифов, и ломать это обещание ради экономии нельзя.
 *
 * Отказ получает только тот, кто ещё ни разу не платил и уже израсходовал
 * бесплатные проверки. Отказ называет остаток и что делать дальше.
 */
export function canStartMeasurement(
  entitlements: Entitlements,
  checksUsed: number,
  checksPlanned = 0,
): LimitDecision {
  if (!entitlements.active) {
    return { allowed: false, message: entitlements.reason };
  }

  if (entitlements.paying) {
    return { allowed: true, message: "" };
  }

  const remaining = FREE_CHECK_ALLOWANCE - checksUsed;

  if (remaining <= 0) {
    return {
      allowed: false,
      message: `The free audit covers ${FREE_CHECK_ALLOWANCE} AI checks and they are used up. Pick a plan to keep measuring — nothing measured so far is lost.`,
    };
  }

  // Прогон начинается целиком или не начинается вовсе: остановиться на
  // середине значит получить долю по неполной выборке, а это цифра, по
  // которой нельзя принимать решение (контракт C3).
  if (checksPlanned > remaining) {
    return {
      allowed: false,
      message: `This run needs ${checksPlanned} AI checks and ${remaining} of the free ${FREE_CHECK_ALLOWANCE} are left. Measure fewer questions or assistants, or pick a plan.`,
    };
  }

  return { allowed: true, message: "" };
}
