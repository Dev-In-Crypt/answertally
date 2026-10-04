"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { api } from "@/trpc/react";
import { cn } from "@/lib/utils";
import { SUPPORT_EMAIL } from "@/config/site";
import { buttonClass } from "@/components/ui/button";
import { NotePanel } from "@/components/ui/note-panel";
import { SkeletonCards } from "@/components/ui/skeleton";

const PLAN_NAMES: Record<string, string> = {
  starter: "Starter",
  growth: "Growth",
  scale: "Scale",
};

const PLAN_ORDER = ["starter", "growth", "scale"];

type PlanChoice = "starter" | "growth" | "scale";

/**
 * Пока провайдер не подтвердил перемену, экран её не рисует.
 *
 * Тариф в базе меняет вебхук, и он приходит через секунды. Показывать
 * новый тариф сразу по нажатию — значит однажды показать его агентству,
 * у которого не прошло списание.
 */
const PENDING_NOTE =
  "The change is with our payment provider. This page updates as soon as it confirms.";

const CHECKOUT_NOTE =
  "Thanks — we are confirming your payment with our payment provider. This page updates on its own, usually within a few seconds.";

/** Сколько ждать подтверждения провайдера, опрашивая экран часто. */
const CONFIRM_WAIT_MS = 60_000;

type SubscriptionSnapshot =
  | {
      status: string | null;
      cancelAtPeriodEnd: boolean;
      hasLiveSubscription: boolean;
      entitlements: { plan: string };
    }
  | undefined;

function snapshotKey(data: SubscriptionSnapshot): string {
  return data ? `${data.entitlements.plan}|${data.status}|${data.cancelAtPeriodEnd}` : "";
}

function usd(value: number): string {
  return `$${value.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

export function BillingView() {
  const router = useRouter();
  // Creem возвращает сюда сразу после оплаты, а вебхук приходит позже: без
  // ожидания экран показывал старый тариф и кнопки, и второй checkout
  // означал бы второй счёт.
  const checkoutReturn = useSearchParams().get("checkout") === "done";

  const [error, setError] = useState<string | null>(null);
  const [confirmPlan, setConfirmPlan] = useState<PlanChoice | null>(null);
  // Пока подтверждения нет, экран опрашивает сервер: вебхук приходит через
  // секунды после нажатия, и без опроса страница так и показывала бы
  // прежнее состояние. `key: null` — ждём живую подписку после checkout.
  const [waiting, setWaiting] = useState<{ key: string | null; until: number } | null>(() =>
    checkoutReturn ? { key: null, until: Date.now() + CONFIRM_WAIT_MS } : null,
  );
  // Минута прошла без подтверждения: сказать это, а не висеть молча.
  const [slow, setSlow] = useState(false);

  useEffect(() => {
    setSlow(false);
    if (!waiting) return;
    const timer = setTimeout(() => setSlow(true), Math.max(0, waiting.until - Date.now()));
    return () => clearTimeout(timer);
  }, [waiting]);

  const isWaiting = (data: SubscriptionSnapshot) =>
    waiting !== null &&
    data !== undefined &&
    (waiting.key === null ? !data.hasLiveSubscription : snapshotKey(data) === waiting.key);

  // После минуты опрос не бросается, а редеет: повтор вебхука у провайдера
  // приходит через 30 секунд и через 5 минут.
  const subscription = api.billing.subscription.useQuery(undefined, {
    refetchInterval: (query) =>
      isWaiting(query.state.data) ? (slow ? 15_000 : 2_000) : false,
  });

  const confirmedCheckout = checkoutReturn && subscription.data?.hasLiveSubscription === true;
  useEffect(() => {
    // Подтверждено — метка в адресе больше не нужна и при перезагрузке солгала бы.
    if (confirmedCheckout) router.replace("/settings/billing");
  }, [confirmedCheckout, router]);

  function begin() {
    setError(null);
    setWaiting(null);
    setConfirmPlan(null);
  }

  function onError(mutationError: { message: string }) {
    setWaiting(null);
    setError(mutationError.message);
  }

  const afterProviderChange = {
    onSuccess: () => {
      setWaiting({ key: snapshotKey(subscription.data), until: Date.now() + CONFIRM_WAIT_MS });
    },
    onError,
  };

  const checkout = api.billing.checkout.useMutation({
    onSuccess: (data) => {
      window.location.href = data.url;
    },
    onError,
  });

  const portal = api.billing.portal.useMutation({
    onSuccess: (data) => {
      window.location.href = data.url;
    },
    onError,
  });

  const changePlan = api.billing.changePlan.useMutation(afterProviderChange);
  const cancel = api.billing.cancel.useMutation(afterProviderChange);
  const resume = api.billing.resume.useMutation(afterProviderChange);

  const data = subscription.data;
  if (!data) {
    if (subscription.error) {
      return (
        <NotePanel title="Could not load your plan" testId="form-error">
          {subscription.error.message}{" "}
          <button type="button" className="underline" onClick={() => subscription.refetch()}>
            Try again
          </button>
        </NotePanel>
      );
    }
    return <SkeletonCards count={2} />;
  }

  const { entitlements } = data;
  const busy =
    checkout.isPending || changePlan.isPending || cancel.isPending || resume.isPending;
  const currentRank = PLAN_ORDER.indexOf(entitlements.plan);
  const pending = isWaiting(data);
  const pastDue = data.status === "past_due";
  // Тариф двигается только у живой подписки без просрочки и не во время
  // ожидания: пока провайдер не ответил, вторая перемена легла бы поверх первой.
  const canChange = data.paymentsConfigured && data.canManage && !pending && !pastDue;
  const free = data.aiChecks.free;
  const planTitle = data.hasLiveSubscription
    ? (PLAN_NAMES[entitlements.plan] ?? entitlements.plan)
    : free
      ? "Free audit"
      : "No active plan";

  const target = confirmPlan ? data.plans.find((plan) => plan.id === confirmPlan) : undefined;
  const targetName = target ? (PLAN_NAMES[target.id] ?? target.id) : "";
  const upgrade = target ? PLAN_ORDER.indexOf(target.id) > currentRank : false;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 rounded-lg border p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <span data-testid="current-plan" className="text-lg font-medium">
            {planTitle}
          </span>
          {(data.hasLiveSubscription || free) && (
            <span className="metric text-sm text-muted-foreground">
              {data.clientsUsed} of {entitlements.clientLimit} clients ·{" "}
              {free
                ? `${data.aiChecks.used.toLocaleString("en-US")} of ${data.aiChecks.allowance.toLocaleString("en-US")} free AI checks used`
                : `${entitlements.aiCheckAllowance.toLocaleString("en-US")} AI checks a month`}
            </span>
          )}
        </div>

        <p data-testid="plan-reason" className="text-sm text-muted-foreground">
          {entitlements.reason}
        </p>

        {/* Дата — только у живой подписки: у закрытой «Renews» читалось бы как будущее списание. */}
        {data.hasLiveSubscription && !pastDue && data.currentPeriodEnd && (
          <p className="metric text-sm text-muted-foreground">
            {data.cancelAtPeriodEnd ? "Ends" : "Renews"} on{" "}
            {new Date(data.currentPeriodEnd).toLocaleDateString()}.
          </p>
        )}
      </div>

      {pastDue && (
        // Сбой списания — это ещё не отказ от продукта: у карты кончился
        // срок, банк отклонил разовый платёж. Отчёты клиентов агентства
        // всё это время продолжают открываться.
        <NotePanel testId="past-due-note" title="A payment did not go through">
          Update the card in Manage billing below and the account keeps running. Plan changes and
          cancelling are available once the payment goes through. Your clients&rsquo; report links
          stay open while this is sorted out.
        </NotePanel>
      )}

      {!data.paymentsConfigured && (
        // Ни фальшивого checkout, ни кнопки, которая упадёт: пока провайдер
        // не подключён, продукт говорит это прямо.
        <p data-testid="payments-off" className="text-sm text-muted-foreground">
          Payments are not connected yet, so plans cannot be changed from here. Everything else in
          the product works.
        </p>
      )}

      {data.paymentsConfigured && !data.canManage && (
        <p data-testid="owner-only" className="text-sm text-muted-foreground">
          Only the agency owner can change the plan or the billing details.
        </p>
      )}

      {pending && (
        <p data-testid="change-pending" className="text-sm text-muted-foreground">
          {slow ? (
            waiting?.key === null ? (
              <>
                Your payment has not been confirmed yet. If you paid, it can take a few minutes —
                this page keeps checking. If nothing changes, write to {SUPPORT_EMAIL}. Closed the
                payment page without paying?{" "}
                <a href="/settings/billing" className="text-primary underline">
                  Choose a plan again
                </a>
                .
              </>
            ) : (
              `Our payment provider has not confirmed the change yet. This page keeps checking — refresh in a few minutes, and if nothing changes write to ${SUPPORT_EMAIL}.`
            )
          ) : waiting?.key === null ? (
            CHECKOUT_NOTE
          ) : (
            PENDING_NOTE
          )}
        </p>
      )}

      {error && (
        <p data-testid="form-error" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        {data.plans.map((plan) => {
          // «Текущий» — только оплаченный: бесплатный и отменённый аккаунт
          // starter не покупали, и купить его должны иметь возможность.
          const current = data.hasLiveSubscription && plan.id === entitlements.plan;
          const rank = PLAN_ORDER.indexOf(plan.id);
          // Одна и та же кнопка ведёт себя по-разному только по надписи:
          // вверх это «Upgrade», вниз — «Switch down», и человек видит, на
          // что он нажимает.
          const label = data.hasLiveSubscription
            ? rank > currentRank
              ? `Upgrade to ${PLAN_NAMES[plan.id] ?? plan.id}`
              : `Switch to ${PLAN_NAMES[plan.id] ?? plan.id}`
            : `Choose ${PLAN_NAMES[plan.id] ?? plan.id}`;

          return (
            <div
              key={plan.id}
              className={cn(
                "flex flex-col gap-2 rounded-lg border p-5",
                current && "border-primary",
              )}
            >
              <span className="font-medium">{PLAN_NAMES[plan.id] ?? plan.id}</span>
              <span className="metric text-2xl font-semibold tracking-tight">
                ${plan.priceUsd.toLocaleString("en-US")}
                <span className="text-sm font-normal text-muted-foreground"> / month</span>
              </span>
              <span className="metric text-sm text-muted-foreground">
                up to {plan.clientLimit} clients ·{" "}
                {plan.aiCheckAllowance.toLocaleString("en-US")} checks
              </span>

              {/* Закрывающуюся подписку провайдер не двигает: сначала «Keep». */}
              {canChange &&
                !current &&
                !(data.hasLiveSubscription && data.cancelAtPeriodEnd) && (
                  <button
                    type="button"
                    data-testid={`choose-${plan.id}`}
                    onClick={() => {
                      begin();
                      // Платящее агентство двигает существующую подписку:
                      // второй checkout означал бы второй счёт за тот же продукт.
                      // Списание сразу — поэтому сначала подтверждение с суммой.
                      if (data.hasLiveSubscription) {
                        setConfirmPlan(plan.id);
                      } else {
                        checkout.mutate({ plan: plan.id });
                      }
                    }}
                    disabled={busy}
                    className={buttonClass(
                      rank > currentRank ? "primary" : "outline",
                      "lg",
                      "mt-2 w-full",
                    )}
                  >
                    {label}
                  </button>
                )}

              {current && (
                <span className="mt-2 text-sm font-medium text-primary">Current plan</span>
              )}
            </div>
          );
        })}
      </div>

      {canChange && target && (
        <div
          data-testid="confirm-plan-change"
          className="flex flex-col gap-3 rounded-lg border border-primary p-5"
        >
          <p className="font-medium">
            {upgrade ? "Upgrade" : "Switch"} to {targetName} — {usd(target.priceUsd)} / month
          </p>
          {upgrade ? (
            <p className="text-sm text-muted-foreground">
              The plan changes today, and our payment provider charges the difference for the rest
              of this period right away
              {target.estimatedChargeNowUsd !== null && (
                <>
                  : an estimated{" "}
                  <span className="metric">{usd(target.estimatedChargeNowUsd)}</span> before any
                  tax. The invoice shows the exact amount
                </>
              )}
              . From the next period you pay {usd(target.priceUsd)} a month.
            </p>
          ) : (
            <p className="text-sm text-muted-foreground">
              The plan changes today: from now on it covers {target.clientLimit} clients and{" "}
              {target.aiCheckAllowance.toLocaleString("en-US")} AI checks a month. Our payment
              provider prorates the rest of this period between the two plans — the invoice shows
              the exact amount — and from the next period you pay {usd(target.priceUsd)} a month.
            </p>
          )}
          {/* Лимит — потолок ровно в 100%: при равенстве новый прогон тоже ждёт. */}
          {!upgrade && data.aiChecks.used >= target.aiCheckAllowance && (
            <p data-testid="confirm-over-allowance" className="text-sm text-destructive">
              This month {data.aiChecks.used.toLocaleString("en-US")} AI checks are already used and{" "}
              {targetName} includes {target.aiCheckAllowance.toLocaleString("en-US")}, so new runs
              would wait until the 1st.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              data-testid="confirm-plan-change-yes"
              onClick={() => {
                begin();
                changePlan.mutate({ plan: target.id });
              }}
              disabled={busy}
              className={buttonClass("primary", "lg")}
            >
              {upgrade ? `Upgrade and pay now` : `Switch to ${targetName}`}
            </button>
            <button
              type="button"
              onClick={() => setConfirmPlan(null)}
              disabled={busy}
              className={buttonClass("outline", "lg")}
            >
              Keep the current plan
            </button>
          </div>
        </div>
      )}

      {canChange && data.hasLiveSubscription && (
        <div className="flex flex-col gap-3 rounded-lg border p-5">
          {data.cancelAtPeriodEnd ? (
            <>
              <p className="text-sm text-muted-foreground">
                This subscription ends when the current period closes. Nothing is lost until then.
                To change the plan, keep the subscription first.
              </p>
              <button
                type="button"
                data-testid="resume-subscription"
                onClick={() => {
                  begin();
                  resume.mutate();
                }}
                disabled={busy}
                className={buttonClass("primary", "lg", "self-start")}
              >
                Keep the subscription
              </button>
            </>
          ) : (
            <>
              {/* Отмена не мгновенная: месяц оплачен, и отчёты в нём обещаны клиентам. */}
              <p className="text-sm text-muted-foreground">
                Cancelling stops the renewal. The plan keeps working until the end of the period
                you have already paid for, and you can undo it any time before then.
              </p>
              <button
                type="button"
                data-testid="cancel-subscription"
                onClick={() => {
                  begin();
                  cancel.mutate();
                }}
                disabled={busy}
                className={buttonClass("danger", "lg", "self-start")}
              >
                Cancel at period end
              </button>
            </>
          )}
        </div>
      )}

      {data.paymentsConfigured && data.canManage && data.hasCustomer && (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            data-testid="open-portal"
            onClick={() => {
              begin();
              portal.mutate();
            }}
            disabled={portal.isPending}
            className={buttonClass("outline", "lg", "self-start")}
          >
            Manage billing
          </button>
          {/* Карта и счета живут у провайдера: продукт платёжных данных не хранит.
              Отмена там мгновенная, поэтому отменять — здесь, кнопкой выше. */}
          <p className="text-sm text-muted-foreground">
            Update the card and download invoices with our payment provider.
            {data.hasLiveSubscription &&
              !data.cancelAtPeriodEnd &&
              !pastDue &&
              " To cancel, use Cancel at period end on this page, so the plan keeps working until the period you paid for ends."}
          </p>
        </div>
      )}
    </div>
  );
}
