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

export type SubscriptionStatus = "trialing" | "active" | "past_due" | "canceled" | "incomplete";

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
  /**
   * Когда подписка ушла в просрочку — от этого считается отсрочка. Пусто у
   * записей, сделанных до появления поля: для них остаётся конец периода.
   */
  pastDueSince?: Date | null;
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
// 7 дней вместо 14 — решение фаундера 08.10.2026 (защита от «пользоваться, не платя»).
export const PAST_DUE_GRACE_DAYS = 7;

const CANCEL_SETTLE_MS = 86_400_000;

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
      // Месячный лимит starter до оплаты не действует: неплательщика
      // ограничивает бесплатный аудит (`canStartMeasurement`), о нём и речь.
      reason: `No plan yet, so the free audit applies: one brand, up to ${FREE_CHECK_ALLOWANCE} AI checks in total.`,
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

  /**
   * Отменённая к концу периода подписка закрывается по дате, а не только по
   * вебхуку. Событие о закрытии может не прийти (сбой доставки, смена ключей
   * провайдера), и тогда «active» с отменой оставался бы платным тарифом
   * навсегда. Сутки запаса — на запоздавшее событие и расхождение часов.
   */
  const endedByDate =
    subscription.cancelAtPeriodEnd &&
    subscription.currentPeriodEnd !== null &&
    now.getTime() > subscription.currentPeriodEnd.getTime() + CANCEL_SETTLE_MS;
  const status = endedByDate ? "canceled" : subscription.status;

  switch (status) {
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
      // Не от чего отсчитывать — значит отсрочки нет, а не бесконечная
      // отсрочка: трактовать пустоту в пользу доступа значит выдать
      // бессрочную бесплатную работу тому, у кого платёж не прошёл.
      //
      // От более раннего из двух: начала просрочки и конца периода. При
      // продлении провайдер сдвигает конец периода вперёд ещё до списания,
      // и неудачное продление давало месяц сверху к отсрочке; а просрочка,
      // о которой мы узнали поздно, не должна начинать отсрочку заново.
      const starts = [subscription.pastDueSince, subscription.currentPeriodEnd].filter(
        (date): date is Date => date instanceof Date,
      );
      const graceFrom =
        starts.length > 0 ? new Date(Math.min(...starts.map((d) => d.getTime()))) : null;
      const deadline = graceFrom
        ? new Date(graceFrom.getTime() + PAST_DUE_GRACE_DAYS * 86_400_000)
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
          status === "canceled"
            ? "The subscription was cancelled."
            : "Checkout was never completed.",
      };
  }
}

/** Числа и тарифы в отказах — как на экране: «4,000», «Starter», а не «4000», «starter». */
function count(value: number): string {
  return value.toLocaleString("en-US");
}

function planLabel(plan: PlanId): string {
  return plan.charAt(0).toUpperCase() + plan.slice(1);
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
      message: `The ${planLabel(entitlements.plan)} plan covers ${entitlements.clientLimit} clients. Upgrade to add more.`,
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
    message: `The ${planLabel(target.plan)} plan covers ${target.clientLimit} clients and you have ${currentClients}. Archive ${extra} ${extra === 1 ? "client" : "clients"} first. Switching would not remove them, and we will not measure more clients than the plan covers.`,
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
 * (2) = 6 ответов. Отсюда 150 покрывают 25 вопросов, а
 * `DEFAULT_GENERATED_PROMPT_COUNT` (24) обходится в 144.
 *
 * То есть ровно один аудит на наборе по умолчанию и один вопрос сверху.
 * Так и обещано на витрине: «one full audit on one brand». Прежние 250
 * растянулись сами, когда из бесплатного аудита убрали Grok, и покрывали
 * ещё и второй аудит вопросов на семнадцать — решения такого никто не
 * принимал.
 *
 * **Цена этой границы.** Агентство, принёсшее свои 26 вопросов и больше,
 * получит отказ на первом же прогоне: он начинается целиком. Это принято
 * осознанно — бесплатный аудит показывает продукт на наборе, который
 * продукт и предлагает.
 */
export const FREE_CHECK_ALLOWANCE = 150;

/**
 * Можно ли начать измерение: хватает ли того, что осталось.
 *
 * Плательщик упирается в месячный лимит своего тарифа — ровно в 100%,
 * решение фаундера. Раньше лимит только показывался, и один тариф за $499
 * мог потратить на ответы ассистентов десятки тысяч в месяц. Начатый прогон
 * не обрывается: отказ получает только следующий, и страница тарифов
 * говорит об этом прямо.
 *
 * Неплательщик упирается в бесплатный остаток за всё время. Отказ называет
 * остаток и что делать дальше.
 */
export interface MeasurementContext {
  /**
   * Сколько прогонов агентства ещё идёт.
   *
   * Проверки списываются, когда ответ уже записан, а решение принимается
   * при старте. Без этого бесплатный аккаунт заводил трёх клиентов и жал
   * «Run now» трижды подряд: каждый раз видно «использовано 0», и уходили
   * три аудита вместо одного.
   */
  runsInFlight?: number;
  /** Кто запускает: человек кнопкой или воркер по расписанию. */
  trigger?: "manual" | "scheduled";
}

/**
 * `checksUsed` для плательщика — расход за текущий биллинговый месяц, для
 * неплательщика — **за всё время**.
 *
 * Бесплатный аудит — один на аккаунт. Считай его по календарному месяцу, и
 * каждый аккаунт получал бы новый аудит первого числа, бессрочно; а с
 * сохранённым расписанием воркер прогонял бы его сам, даже у того, кто
 * давно ушёл.
 */
export function canStartMeasurement(
  entitlements: Entitlements,
  checksUsed: number,
  checksPlanned = 0,
  context: MeasurementContext = {},
): LimitDecision {
  if (!entitlements.active) {
    return { allowed: false, message: entitlements.reason };
  }

  if (entitlements.paying) {
    const left = Math.max(0, entitlements.aiCheckAllowance - checksUsed);
    if (checksPlanned > left) {
      return {
        allowed: false,
        message:
          left === 0
            ? `This month's ${count(entitlements.aiCheckAllowance)} AI checks are used up. Measuring resumes when your next billing month starts, or write to us to raise the allowance.`
            : `This run needs ${count(checksPlanned)} AI checks and ${count(left)} of this month's ${count(entitlements.aiCheckAllowance)} are left. Measure fewer questions or assistants, or write to us to raise the allowance.`,
      };
    }
    return { allowed: true, message: "" };
  }

  // Измерение по расписанию — платная часть продукта. Бесплатный аудит
  // запускается руками и один раз; брошенный аккаунт не должен тратить ничего.
  if (context.trigger === "scheduled") {
    return {
      allowed: false,
      message: "Scheduled checks start with a plan. The free audit runs once, when you start it.",
    };
  }

  if ((context.runsInFlight ?? 0) > 0) {
    return {
      allowed: false,
      message:
        "Your audit is still running. It covers one brand; once it finishes, you can read it in full.",
    };
  }

  const remaining = FREE_CHECK_ALLOWANCE - checksUsed;

  if (remaining <= 0) {
    return {
      allowed: false,
      message: `The free audit covers ${FREE_CHECK_ALLOWANCE} AI checks and they are used up. Pick a plan to keep measuring. Nothing measured so far is lost.`,
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
