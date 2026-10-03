import {
  billingPeriod,
  billingPeriodBounds,
  canStartMeasurement,
  entitlementsFor,
  type Entitlements,
  type LimitDecision,
} from "@repo/core";
import {
  countRunsInFlight,
  createRun,
  domainMeasuredElsewhere,
  getClientById,
  getLifetimeAiChecks,
  getSubscriptionByAgency,
  getUsageCounter,
  lockAgency,
  sumPlannedChecks,
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
 * Можно ли начать измерение агентству — единственная такая проверка.
 *
 * Её зовут и веб (кнопка, аудит), и воркер (расписание) — через
 * `startRunIfAllowed`, которая проверяет и создаёт прогон под одной
 * блокировкой. Раньше у каждого была своя проверка, и воркерная не знала ни
 * сколько прогон потратит, ни кто его запускает.
 *
 * Израсходованным считается бо́льшее из счётчика ответов и суммы одобренных
 * прогонов: счётчик не видит идущих прогонов и платных вызовов, упавших до
 * записи, а у прогонов, созданных до появления размера, суммы нет.
 * Плательщику — за текущий месяц, неплательщику — за всё время.
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
  let used: number;

  if (entitlements.paying) {
    const period = billingPeriod(now);
    const [counter, planned] = await Promise.all([
      getUsageCounter(db, agencyId, period),
      sumPlannedChecks(db, agencyId, billingPeriodBounds(period).start),
    ]);
    used = Math.max(counter?.aiChecksUsed ?? 0, planned);
  } else {
    const [counted, planned, inFlight] = await Promise.all([
      getLifetimeAiChecks(db, agencyId),
      sumPlannedChecks(db, agencyId),
      countRunsInFlight(db, agencyId, now),
    ]);
    used = Math.max(counted, planned);
    context.runsInFlight = inFlight;
  }

  return canStartMeasurement(entitlements, used, run.checksPlanned ?? 0, context);
}

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

    // Бесплатный аудит — один на бренд, а не на аккаунт: десять аккаунтов на
    // один сайт были бы десятью аудитами одного и того же за наш счёт.
    if (
      values.adaptersMode === "live" &&
      !(await entitlementsForAgency(tx, agencyId, now)).paying
    ) {
      const client = await getClientById(tx, values.clientId);
      if (client && (await domainMeasuredElsewhere(tx, client.domain, agencyId))) {
        return {
          decision: {
            allowed: false,
            message: `${client.domain} already had its free audit in another workspace. Pick a plan to measure it, or audit a different brand.`,
          },
          run: null,
        };
      }
    }

    const run = await createRun(tx, { ...values, plannedChecks: checksPlanned });
    return { decision, run };
  });
}
