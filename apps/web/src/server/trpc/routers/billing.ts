import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  billingPeriod,
  billingPeriodBounds,
  canSwitchToPlan,
  checkWeight,
  FREE_CHECK_ALLOWANCE,
  PLAN_LIMITS,
  sumCostUsd,
  usageStatus,
  type Entitlements,
  type PaymentProvider,
  type PlanId,
} from "@repo/core";
import {
  countClientsByAgency,
  countFixtureAnswers,
  getAgencyById,
  getLifetimeAiChecks,
  getSubscriptionByAgency,
  getUsageCounter,
  listCostsByClientAndPlatform,
  type Database,
  type Subscription,
} from "@repo/db";
import { allowedAssistantLabels } from "@repo/core/adapters/capacity";
import { protectedProcedure, roleProcedure, router } from "../trpc";
import { SUPPORT_EMAIL } from "@/config/site";
import { appUrl } from "../../email";
import { getPaymentProvider } from "../../payments";
import { entitlementsForAgency } from "../../subscription";

const planInput = z.object({ plan: z.enum(["starter", "growth", "scale"]) });

/**
 * Подписка, в которой ещё есть что двигать.
 *
 * `canceled` и `incomplete` — это уже не подписка: менять в ней тариф
 * нечего, такому агентству нужен новый checkout.
 */
const LIVE_STATUSES = new Set(["trialing", "active", "past_due"]);

function requirePayments(): PaymentProvider {
  const payments = getPaymentProvider();
  if (!payments.configured) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "Payments are not connected yet.",
    });
  }
  return payments;
}

export const billingRouter = router({
  /**
   * Что агентство получает сейчас и что может выбрать.
   *
   * `paymentsConfigured` отдаётся честно: без ключей продукт не показывает
   * кнопку оплаты, которая упадёт, — он говорит, что оплата не подключена.
   */
  subscription: protectedProcedure.query(async ({ ctx }) => {
    const [entitlements, subscription, clientsUsed] = await Promise.all([
      entitlementsForAgency(ctx.db, ctx.user.agencyId),
      getSubscriptionByAgency(ctx.db, ctx.user.agencyId),
      countClientsByAgency(ctx.db, ctx.user.agencyId),
    ]);
    const live = isLive(subscription);
    const currentPrice = PLAN_LIMITS[entitlements.plan].priceUsd;

    return {
      entitlements,
      clientsUsed,
      aiChecks: await checksFor(
        ctx.db,
        ctx.user.agencyId,
        entitlements,
        billingPeriod(),
        entitlements.aiCheckAllowance,
      ),
      // Платёжные кнопки — только у владельца: остальным сервер всё равно
      // откажет, и экран говорит это заранее, а не после нажатия.
      canManage: ctx.user.role === "owner",
      paymentsConfigured: getPaymentProvider().configured,
      status: subscription?.status ?? null,
      currentPeriodEnd: subscription?.currentPeriodEnd ?? null,
      cancelAtPeriodEnd: subscription?.cancelAtPeriodEnd ?? false,
      hasCustomer: Boolean(subscription?.customerId),
      /**
       * Есть ли подписка, которую можно двигать.
       *
       * Экран выбирает по этому флагу между «оплатить» и «перейти»: второй
       * checkout у платящего агентства завёл бы вторую подписку и второй
       * счёт за тот же продукт.
       */
      hasLiveSubscription: live,
      plans: (Object.keys(PLAN_LIMITS) as PlanId[]).map((id) => ({
        id,
        ...PLAN_LIMITS[id],
        /** Кого тариф позволяет включить — карточка называет их, а не «ассистентов вообще». */
        assistants: allowedAssistantLabels(id).join(", "),
        /** Сколько провайдер спишет сразу при повышении — оценка для подтверждения. */
        estimatedChargeNowUsd: live
          ? estimateUpgradeChargeUsd(
              currentPrice,
              PLAN_LIMITS[id].priceUsd,
              subscription?.currentPeriodEnd ?? null,
            )
          : null,
      })),
    };
  }),

  /** Ссылка на оплату. Деньги принимает провайдер, продукт их не видит. */
  checkout: roleProcedure("owner")
    .input(planInput)
    .mutation(async ({ ctx, input }) => {
      const payments = requirePayments();

      const subscription = await getSubscriptionByAgency(ctx.db, ctx.user.agencyId);
      if (isLive(subscription)) {
        // Иначе агентство платило бы дважды за один продукт.
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "This agency already has a subscription. Change the plan instead.",
        });
      }

      const base = `${appUrl()}/settings/billing`;

      const session = await viaProvider(() =>
        payments.createCheckout({
          agencyId: ctx.user.agencyId,
        plan: input.plan,
        email: ctx.user.email,
        successUrl: `${base}?checkout=done`,
        cancelUrl: base,
          ...(subscription?.customerId ? { customerId: subscription.customerId } : {}),
        }),
      );

      return { url: session.url };
    }),

  /**
   * Переход между тарифами вверх и вниз.
   *
   * Правит цену в существующей подписке, а не заводит вторую: второй
   * checkout у платящего агентства — это второй счёт за тот же продукт.
   *
   * В базу здесь не пишется ничего. Источник истины о деньгах — провайдер,
   * и новый тариф приедет вебхуком: запись «по факту нажатия» разошлась бы
   * с реальностью ровно в тот момент, когда списание не прошло.
   */
  changePlan: roleProcedure("owner")
    .input(planInput)
    .mutation(async ({ ctx, input }) => {
      const payments = requirePayments();
      const subscription = await requireLiveSubscription(ctx.db, ctx.user.agencyId);

      if (subscription.plan === input.plan) {
        return { plan: input.plan, changed: false };
      }

      refuseWhilePastDue(subscription);

      // Провайдер не меняет тариф подписки, которая уже закрывается.
      if (subscription.cancelAtPeriodEnd) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This subscription is set to end. Keep the subscription first, then change the plan.",
        });
      }

      /**
       * Понижение ниже числа заведённых клиентов не пропускается.
       *
       * Иначе агентство платит за три клиента, а меряется пять: отключить
       * лишних за него мы не можем (это его данные и его обязательства
       * перед своими клиентами), а оставить — значит отдавать больше, чем
       * куплено. Решение остаётся за человеком и принимается до списания.
       */
      const clientsUsed = await countClientsByAgency(ctx.db, ctx.user.agencyId);
      const target = PLAN_LIMITS[input.plan];
      const decision = canSwitchToPlan(
        { plan: input.plan, clientLimit: target.clientLimit },
        clientsUsed,
      );

      if (!decision.allowed) {
        throw new TRPCError({ code: "BAD_REQUEST", message: decision.message });
      }

      await viaProvider(() =>
        payments.changePlan({ subscriptionId: subscription.subscriptionId, plan: input.plan }),
      );

      return { plan: input.plan, changed: true };
    }),

  /**
   * Отмена в конце оплаченного периода.
   *
   * Не мгновенная: агентство заплатило за месяц и должно его доработать —
   * у него в этом месяце отчёты, которые обещаны его клиентам.
   */
  cancel: roleProcedure("owner").mutation(async ({ ctx }) => {
    const payments = requirePayments();
    const subscription = await requireLiveSubscription(ctx.db, ctx.user.agencyId);
    refuseWhilePastDue(subscription);

    await viaProvider(() =>
      payments.setCancelAtPeriodEnd({
        subscriptionId: subscription.subscriptionId,
        cancelAtPeriodEnd: true,
      }),
    );

    return { cancelAtPeriodEnd: true };
  }),

  /** Передумали до конца периода — подписка возвращается в строй без нового checkout. */
  resume: roleProcedure("owner").mutation(async ({ ctx }) => {
    const payments = requirePayments();
    const subscription = await requireLiveSubscription(ctx.db, ctx.user.agencyId);

    await viaProvider(() =>
      payments.setCancelAtPeriodEnd({
        subscriptionId: subscription.subscriptionId,
        cancelAtPeriodEnd: false,
      }),
    );

    return { cancelAtPeriodEnd: false };
  }),

  /**
   * Карта и счета — на стороне провайдера: продукт не хранит платёжные данные.
   * Отменять туда не посылаем: в портале отмена мгновенная, а наша — в конце
   * оплаченного периода.
   */
  portal: roleProcedure("owner").mutation(async ({ ctx }) => {
    const payments = getPaymentProvider();
    const subscription = await getSubscriptionByAgency(ctx.db, ctx.user.agencyId);

    if (!payments.configured || !subscription?.customerId) {
      throw new TRPCError({
        code: "PRECONDITION_FAILED",
        message: "There is no billing account to manage yet.",
      });
    }

    const customerId = subscription.customerId;
    const session = await viaProvider(() =>
      payments.createPortal({ customerId, returnUrl: `${appUrl()}/settings/billing` }),
    );

    return { url: session.url };
  }),

  usage: protectedProcedure
    .input(z.object({ period: z.string().regex(/^\d{4}-\d{2}$/).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const period = input?.period ?? billingPeriod();

      const [agency, entitlements, clientsUsed] = await Promise.all([
        getAgencyById(ctx.db, ctx.user.agencyId),
        entitlementsForAgency(ctx.db, ctx.user.agencyId),
        countClientsByAgency(ctx.db, ctx.user.agencyId),
      ]);

      const plan = agency?.plan ?? "starter";
      const limits = PLAN_LIMITS[plan];
      const checks = await checksFor(
        ctx.db,
        ctx.user.agencyId,
        entitlements,
        period,
        limits.aiCheckAllowance,
      );

      return {
        period,
        plan,
        aiChecks: checks,
        clients: {
          used: clientsUsed,
          limit: agency?.clientLimit ?? limits.clientLimit,
        },
      };
    }),

  /**
   * Стоимость измерений за период — внутренняя страница агентства.
   *
   * Роль не ниже admin: это финансовые данные всего агентства, а member
   * ведёт своих клиентов. Клиенту агентства эти цифры не показываются нигде.
   */
  costs: roleProcedure("admin")
    .input(z.object({ period: z.string().regex(/^\d{4}-\d{2}$/).optional() }).optional())
    .query(async ({ ctx, input }) => {
      const period = input?.period ?? billingPeriod();
      const { start, end } = billingPeriodBounds(period);

      const [rows, fixtureAnswers] = await Promise.all([
        listCostsByClientAndPlatform(ctx.db, ctx.user.agencyId, start, end),
        countFixtureAnswers(ctx.db, ctx.user.agencyId, start, end),
      ]);

      const byClient = new Map<string, { clientId: string; clientName: string; costs: string[]; responses: number; checks: number }>();
      for (const row of rows) {
        const entry = byClient.get(row.clientId) ?? {
          clientId: row.clientId,
          clientName: row.clientName,
          costs: [],
          responses: 0,
          checks: 0,
        };
        entry.costs.push(row.costUsd);
        entry.responses += row.responses;
        entry.checks += row.responses * checkWeight(row.platform);
        byClient.set(row.clientId, entry);
      }

      return {
        period,
        periodStart: start,
        periodEnd: end,
        rows,
        clients: [...byClient.values()].map((entry) => ({
          clientId: entry.clientId,
          clientName: entry.clientName,
          responses: entry.responses,
          checks: entry.checks,
          costUsd: sumCostUsd(entry.costs),
        })),
        totalCostUsd: sumCostUsd(rows.map((row) => row.costUsd)),
        totalResponses: rows.reduce((total, row) => total + row.responses, 0),
        /** Проверки с лимита: ответ Grok весит 5, Claude 4 (`checkWeight`). */
        totalChecks: rows.reduce((total, row) => total + row.responses * checkWeight(row.platform), 0),
        /** Ответы на фикстурах: в счёт не входят, но о них надо сказать. */
        fixtureAnswers,
      };
    }),
});

function isLive(subscription: Subscription | undefined): boolean {
  return Boolean(subscription?.subscriptionId) && LIVE_STATUSES.has(subscription?.status ?? "");
}

/**
 * Расход проверок — по тому же правилу, что и проверка при старте прогона.
 *
 * Неплательщик меряет бесплатный аудит: за всё время, против
 * `FREE_CHECK_ALLOWANCE`. Показывать ему месячный лимит starter значило
 * обещать проверки, в которых прогон ему потом откажет.
 */
async function checksFor(
  db: Database,
  agencyId: string,
  entitlements: Entitlements,
  period: string,
  paidAllowance: number,
) {
  if (!entitlements.paying && entitlements.active) {
    const used = await getLifetimeAiChecks(db, agencyId);
    return { ...usageStatus(used, FREE_CHECK_ALLOWANCE), free: true };
  }
  const counter = await getUsageCounter(db, agencyId, period);
  return { ...usageStatus(counter?.aiChecksUsed ?? 0, paidAllowance), free: false };
}

/**
 * Сколько провайдер спишет сразу при повышении: разница цен × доля периода,
 * которая ещё впереди. Оценка — точную сумму (с налогом) считает провайдер.
 *
 * Период месячный: начало — тот же день месяцем раньше, а если такого дня
 * нет (31-е), последний день прошлого месяца.
 */
export function estimateUpgradeChargeUsd(
  fromPriceUsd: number,
  toPriceUsd: number,
  periodEnd: Date | null,
  now: Date = new Date(),
): number | null {
  if (!periodEnd || toPriceUsd <= fromPriceUsd) return null;

  const start = new Date(periodEnd);
  start.setUTCMonth(start.getUTCMonth() - 1);
  if (start.getUTCDate() !== periodEnd.getUTCDate()) start.setUTCDate(0);

  const total = periodEnd.getTime() - start.getTime();
  const left = Math.min(1, Math.max(0, (periodEnd.getTime() - now.getTime()) / total));
  return Math.round((toPriceUsd - fromPriceUsd) * left * 100) / 100;
}

/**
 * Пока платёж просрочен, провайдер не двигает подписку (`subscription_not_active`),
 * и «попробуйте через минуту» тут не поможет: сначала карта.
 */
function refuseWhilePastDue(subscription: Subscription): void {
  if (subscription.status === "past_due") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "The last payment did not go through. Update the card in Manage billing first. Plan changes and cancelling are available once the account is paid up.",
    });
  }
}

/**
 * Подписка, которой можно управлять, — или понятный отказ.
 *
 * Читается из нашей базы, а не из провайдера: слепок там свежий, его
 * держит вебхук, а лишний поход в сеть на каждый клик — это ещё один
 * способ уронить экран, когда провайдер моргнул.
 */
/**
 * Отказ провайдера — человеку понятной фразой, подробности — в журнал.
 *
 * Сырой ответ провайдера на экране агентства ничего ему не говорит, а
 * показывает внутренности: идентификаторы запросов, коды, имена полей.
 */
async function viaProvider<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    console.error("[billing] payment provider call failed", error);
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Our payment provider did not accept this change. Try again in a minute or write to ${SUPPORT_EMAIL}.`,
    });
  }
}

async function requireLiveSubscription(
  db: Database,
  agencyId: string,
): Promise<Subscription & { subscriptionId: string }> {
  const subscription = await getSubscriptionByAgency(db, agencyId);

  if (!subscription?.subscriptionId || !LIVE_STATUSES.has(subscription.status)) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "There is no live subscription to change. Pick a plan to start one.",
    });
  }

  return subscription as Subscription & { subscriptionId: string };
}
