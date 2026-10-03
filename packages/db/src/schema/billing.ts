import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { agencies, planEnum } from "./tenancy";

/**
 * Расход по агентству за биллинговый период.
 *
 * Единица тарификации продукта — активный клиентский аккаунт, но переменная
 * стоимость создаётся вызовами к платформам, поэтому их считаем отдельно:
 * без этого счётчика нельзя ни выставить overage, ни заметить, что клиент
 * с сотней промптов съедает маржу.
 */
export const usageCounters = pgTable(
  "usage_counters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    /** Биллинговый период в формате YYYY-MM (UTC). */
    period: text("period").notNull(),
    /** Один ответ платформы = один AI check. */
    aiChecksUsed: integer("ai_checks_used").notNull().default(0),
    clientsActive: integer("clients_active").notNull().default(0),
    promptsActive: integer("prompts_active").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [uniqueIndex("usage_counters_agency_period_idx").on(table.agencyId, table.period)],
);

export type UsageCounter = typeof usageCounters.$inferSelect;
export type NewUsageCounter = typeof usageCounters.$inferInsert;

/**
 * Состояния подписки у платёжного провайдера.
 *
 * Список повторяет статусы Stripe, а не упрощает их до «платит / не платит»:
 * `past_due` — это ещё клиент, у которого не прошёл платёж, и выкидывать его
 * из продукта в тот же час нельзя; `incomplete` — это ещё не клиент.
 */
export const subscriptionStatusEnum = pgEnum("subscription_status", [
  "trialing",
  "active",
  "past_due",
  "canceled",
  "incomplete",
]);

/**
 * Подписка агентства.
 *
 * Права доступа считаются от неё, а не от полей `agencies.plan` и
 * `agencies.client_limit`: те остаются производными и обновляются из вебхука.
 * Источник истины о деньгах — провайдер, и в базе лежит его слепок,
 * чтобы продукт мог работать, пока провайдер недоступен.
 */
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    /** Пока провайдер один, но столбец есть: смена биллинга не должна ломать схему. */
    provider: text("provider").notNull().default("stripe"),
    customerId: text("customer_id").notNull(),
    subscriptionId: text("subscription_id"),
    plan: planEnum("plan").notNull(),
    status: subscriptionStatusEnum("status").notNull(),
    /** До какого момента оплачен период — по нему решается доступ при сбое платежа. */
    currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    /**
     * Клиентские аккаунты сверх тарифа, купленные по оптовой цене.
     *
     * Здесь, а не поднятым лимитом у агентства: там поле производное, его
     * переписывает каждое событие подписки, и агентство с сорока клиентами
     * однажды проснулось бы с потолком в двадцать пять. Событие провайдера
     * это число не несёт, поэтому запись подписки его не трогает.
     */
    extraClientAccounts: integer("extra_client_accounts").notNull().default(0),
    /**
     * Время события провайдера, которым записано это состояние.
     *
     * Доставка вебхуков не упорядочена: задержавшийся повтор более раннего
     * события приходит после более позднего и откатывает тариф назад —
     * агентство, только что перешедшее на Scale, видит лимит Starter.
     * Защита по `payment_events` от этого не спасает: у событий разные id.
     * Пусто — состояние записано до того, как счёт появился (или не из
     * события вовсе); такое состояние перезаписывается любым событием.
     */
    lastEventAt: timestamp("last_event_at", { withTimezone: true }),
    /**
     * Когда подписка ушла в просрочку. Отсрочка считается от этого момента.
     *
     * Раньше — от конца оплаченного периода, а при продлении провайдер
     * сдвигает его вперёд до списания: неудачное продление давало около
     * сорока четырёх дней работы вместо четырнадцати. Пусто вне просрочки.
     */
    pastDueSince: timestamp("past_due_since", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    // Одна подписка на агентство: вторая означала бы двойную оплату.
    uniqueIndex("subscriptions_agency_idx").on(table.agencyId),
    uniqueIndex("subscriptions_customer_idx").on(table.customerId),
  ],
);

export type Subscription = typeof subscriptions.$inferSelect;
export type NewSubscription = typeof subscriptions.$inferInsert;

/**
 * Журнал обработанных событий платёжного провайдера.
 *
 * Stripe повторяет доставку до трёх суток, и повтор обязан ничего не менять
 * во второй раз: иначе одно событие смены тарифа применится дважды. Защита —
 * сам первичный ключ: событие «занимается» вставкой до того, как что-то
 * записано, и вторая вставка падает на конфликте.
 *
 * Журнала в памяти для этого мало: он не переживает перезапуск и не общий у
 * двух экземпляров веба, а повтор приходит как раз тогда, когда первый раз
 * что-то пошло не так.
 *
 * `agency_id` здесь намеренно нет: событие занимается раньше, чем известно,
 * чьё оно, и сама запись — технический след без данных агентства.
 */
export const paymentEvents = pgTable(
  "payment_events",
  {
    /** Идентификатор события у провайдера (evt_…). */
    eventId: text("event_id").primaryKey(),
    provider: text("provider").notNull().default("stripe"),
    /** Момент создания события у провайдера, а не у нас: доставка не упорядочена. */
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    processedAt: timestamp("processed_at", { withTimezone: true }).notNull().defaultNow(),
  },
  // Для уборки старых записей. Возраст считается по времени события у
  // провайдера, а не по нашему: повторять он перестаёт по своему сроку.
  (table) => [index("payment_events_occurred_at_idx").on(table.occurredAt)],
);

export type PaymentEvent = typeof paymentEvents.$inferSelect;
