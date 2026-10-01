import { upsertSubscription, type Database } from "@repo/db";

/**
 * Делает агентство плательщиком.
 *
 * Нужна тестам, которые описывают обычную работу: прогоны, свёртки,
 * счётчики. До первой оплаты набор ассистентов уже — бесплатный аудит не
 * включает Grok, — и тест про арифметику свёрток считал бы по двум
 * платформам вместо трёх, ничего об этом не сказав.
 *
 * Бесплатный случай проверяется отдельно и явно, а не тем, что фикстура
 * забыла про подписку.
 */
export async function makePaying(
  db: Database,
  agencyId: string,
  plan: "starter" | "growth" | "scale" = "starter",
): Promise<void> {
  await upsertSubscription(db, {
    agencyId,
    customerId: `cus_${agencyId.slice(0, 8)}`,
    subscriptionId: `sub_${agencyId.slice(0, 8)}`,
    plan,
    status: "active",
    currentPeriodEnd: new Date("2099-01-01T00:00:00.000Z"),
    cancelAtPeriodEnd: false,
  });
}
