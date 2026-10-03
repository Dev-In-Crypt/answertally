import { canStartMeasurement, entitlementsFor, type Entitlements, type LimitDecision } from "@repo/core";
import {
  countRunsInFlight,
  getLifetimeAiChecks,
  getSubscriptionByAgency,
  type Database,
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
        }
      : null,
    now,
  );
}

/**
 * Можно ли начать измерение агентству — единственная такая проверка.
 *
 * Её зовут и веб (кнопка, аудит), и воркер (расписание). Раньше у каждого
 * была своя, и воркерная не знала ни сколько прогон потратит, ни кто его
 * запускает: при «можно» она запускала все созревшие расписания агентства
 * разом, а бесплатный счётчик брала за календарный месяц — то есть каждый
 * брошенный бесплатный аккаунт получал новый аудит первого числа.
 *
 * Плательщику права проверяются без счётчиков: ему не отказывают.
 */
export async function measurementAllowedForAgency(
  db: Database,
  agencyId: string,
  run: { trigger: "manual" | "scheduled"; checksPlanned?: number },
  now: Date = new Date(),
): Promise<LimitDecision> {
  const entitlements = await entitlementsForAgency(db, agencyId, now);
  if (!entitlements.active || entitlements.paying) {
    return canStartMeasurement(entitlements, 0);
  }

  // ponytail: проверка и создание прогона — не одна транзакция. Два запроса,
  // пришедшие одновременно до создания первого прогона, оба увидят ноль идущих.
  // Окно — миллисекунды, потолок — три клиента бесплатного аккаунта. Закрывать
  // блокировкой на агентство, если это начнут делать нарочно.
  const [used, inFlight] = await Promise.all([
    getLifetimeAiChecks(db, agencyId),
    countRunsInFlight(db, agencyId, now),
  ]);

  return canStartMeasurement(entitlements, used, run.checksPlanned ?? 0, {
    runsInFlight: inFlight,
    trigger: run.trigger,
  });
}
