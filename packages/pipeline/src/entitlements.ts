import {
  allowancePeriod,
  canStartMeasurement,
  entitlementsFor,
  type Entitlements,
  type LimitDecision,
} from "@repo/core";
import {
  clientHasLiveRunInFlight,
  countClientsByAgency,
  countRunsInFlight,
  createRun,
  domainMeasuredElsewhere,
  getClientById,
  getLifetimeAiChecks,
  getSubscriptionByAgency,
  getUsageCounter,
  inFlightRemainingChecks,
  lockAgency,
  type Database,
  type NewRun,
  type Run,
} from "@repo/db";

/**
 * Права агентства по его подписке.
 *
 * Лежит здесь, а не в приложении, потому что спрашивают об этом оба:
 * веб — когда человек нажимает «измерить», воркер — когда то же измерение
 * начинает расписание. Два вычисления одного права разъехались бы молча, и
 * цена расхождения — наши деньги, потраченные на того, кто перестал платить.
 *
 * Отсутствие подписки — не ошибка: у только что заведённого агентства её нет,
 * и права считаются от умолчания (`entitlementsFor(null)`).
 */
export async function entitlementsForAgency(
  db: Database,
  agencyId: string,
  now: Date = new Date(),
): Promise<Entitlements> {
  const subscription = await getSubscriptionByAgency(db, agencyId);

  return entitlementsFor(
    subscription
      ? {
          plan: subscription.plan,
          status: subscription.status,
          currentPeriodEnd: subscription.currentPeriodEnd,
          cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
          extraClientAccounts: subscription.extraClientAccounts,
          pastDueSince: subscription.pastDueSince,
        }
      : null,
    now,
  );
}

/**
 * Ключ счётчика проверок агентства — его оплаченный месяц (`allowancePeriod`).
 * Один на запись (воркер), проверку лимита и экран расхода: разъедутся — и
 * счётчик пишется в один месяц, а лимит сверяется с другим.
 */
export async function usagePeriodForAgency(
  db: Database,
  agencyId: string,
  now: Date = new Date(),
): Promise<string> {
  const subscription = await getSubscriptionByAgency(db, agencyId);
  return allowancePeriod(subscription?.currentPeriodEnd ?? null, now);
}

/**
 * Можно ли начать измерение агентству — единственная такая проверка.
 *
 * Её зовут и веб (кнопка, аудит), и воркер (расписание) — через
 * `startRunIfAllowed`, которая проверяет и создаёт прогон под одной
 * блокировкой. Раньше у каждого была своя проверка, и воркерная не знала ни
 * сколько прогон потратит, ни кто его запускает.
 *
 * Израсходованным считаются записанные ответы плюс то, что идущие прогоны
 * ещё вправе потратить (`inFlightRemainingChecks`). Упавший до первого
 * ответа прогон не стоит ничего: иначе сбой у провайдера сжигал бы
 * бесплатный аудит, которого человек так и не получил.
 */
export async function measurementAllowedForAgency(
  db: Database,
  agencyId: string,
  run: { trigger: "manual" | "scheduled"; checksPlanned?: number },
  now: Date = new Date(),
): Promise<LimitDecision> {
  const entitlements = await entitlementsForAgency(db, agencyId, now);
  if (!entitlements.active) {
    return canStartMeasurement(entitlements, 0);
  }

  const context = { trigger: run.trigger, runsInFlight: 0 };

  // Израсходовано = записанные ответы + то, что идущие прогоны ещё вправе
  // потратить. Плательщику — за месяц, неплательщику — за всё время.
  const [counted, inFlightRemaining] = await Promise.all([
    entitlements.paying
      ? usagePeriodForAgency(db, agencyId, now)
          .then((period) => getUsageCounter(db, agencyId, period))
          .then((row) => row?.aiChecksUsed ?? 0)
      : getLifetimeAiChecks(db, agencyId),
    inFlightRemainingChecks(db, agencyId),
  ]);
  const used = counted + inFlightRemaining;

  if (!entitlements.paying) {
    context.runsInFlight = await countRunsInFlight(db, agencyId, now);
  }

  return canStartMeasurement(entitlements, used, run.checksPlanned ?? 0, context);
}

/** Отказ, когда у клиента уже идёт замер. */
export const RUN_IN_FLIGHT_MESSAGE =
  "A check is already running for this client. Its results appear when it finishes, usually within a few minutes.";

export interface StartRunResult {
  decision: LimitDecision;
  run: Run | null;
}

/**
 * Проверить лимит и создать прогон — атомарно для агентства.
 *
 * Проверка и вставка идут в одной транзакции под advisory-блокировкой по
 * агентству. Без неё двадцать одновременных запросов (один batch tRPC) все
 * видели «израсходовано 0, идущих 0» и создавали двадцать бесплатных
 * аудитов. Блокировка снимается с концом транзакции; других агентств она
 * не задерживает.
 *
 * Размер записывается в прогон: воркер больше одобренного не поставит.
 */
export async function startRunIfAllowed(
  db: Database,
  agencyId: string,
  values: Omit<NewRun, "plannedChecks">,
  checksPlanned: number,
  now: Date = new Date(),
): Promise<StartRunResult> {
  return db.transaction(async (tx) => {
    await lockAgency(tx, agencyId);
    const decision = await measurementAllowedForAgency(
      tx,
      agencyId,
      { trigger: values.trigger ?? "scheduled", checksPlanned },
      now,
    );
    if (!decision.allowed) {
      return { decision, run: null };
    }

    const refusal = await afterDowngradeOrFarming(tx, agencyId, values, now);
    if (refusal) {
      return { decision: { allowed: false, message: refusal }, run: null };
    }

    const run = await createRun(tx, { ...values, plannedChecks: checksPlanned });
    return { decision, run };
  });
}

/**
 * Отказы, которых не знает счётчик проверок. Пусто — можно.
 *
 * - Клиентов больше, чем покрывает тариф: лимит проверялся только при
 *   заведении, и понижение тарифа (или смена его в кабинете провайдера)
 *   оставляло агентству всех прежних клиентов.
 * - Бесплатный аудит — один на бренд, а не на аккаунт: десять аккаунтов на
 *   один сайт были бы десятью аудитами одного и того же за наш счёт.
 */
async function afterDowngradeOrFarming(
  db: Database,
  agencyId: string,
  values: Omit<NewRun, "plannedChecks">,
  now: Date,
): Promise<string | null> {
  const entitlements = await entitlementsForAgency(db, agencyId, now);

  // Второй прогон поверх идущего — вторая оплата тех же вопросов: кнопка
  // после перезагрузки страницы снова активна, а расписание может созреть
  // посреди ручного замера.
  if (values.adaptersMode === "live" && (await clientHasLiveRunInFlight(db, values.clientId, now))) {
    return RUN_IN_FLIGHT_MESSAGE;
  }

  const clients = await countClientsByAgency(db, agencyId);
  if (clients > entitlements.clientLimit) {
    // Тариф — как на экране («Starter»), как и в отказах core.
    const plan = entitlements.plan.charAt(0).toUpperCase() + entitlements.plan.slice(1);
    return `The workspace has ${clients} clients and the ${plan} plan covers ${entitlements.clientLimit}. Remove clients, or upgrade under Settings → Billing, to keep measuring.`;
  }

  if (values.adaptersMode === "live" && !entitlements.paying) {
    const client = await getClientById(db, values.clientId);
    if (client && (await domainMeasuredElsewhere(db, client.domain, agencyId))) {
      // Текст общий: назвать «другое агентство» значило бы сказать
      // постороннему, что этот бренд у кого-то на платформе есть.
      return `${client.domain} has already had its free audit. Pick a plan under Settings → Billing to measure it, or audit a different brand.`;
    }
  }

  return null;
}
