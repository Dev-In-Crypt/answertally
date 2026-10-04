"use client";

import { useState } from "react";
import { api } from "@/trpc/react";
import { cn } from "@/lib/utils";
import { buttonClass } from "@/components/ui/button";
import { NotePanel } from "@/components/ui/note-panel";
import { SkeletonCards } from "@/components/ui/skeleton";

const PLAN_NAMES: Record<string, string> = {
  starter: "Starter",
  growth: "Growth",
  scale: "Scale",
};

const PLAN_ORDER = ["starter", "growth", "scale"];

/**
 * Пока провайдер не подтвердил перемену, экран её не рисует.
 *
 * Тариф в базе меняет вебхук, и он приходит через секунды. Показывать
 * новый тариф сразу по нажатию — значит однажды показать его агентству,
 * у которого не прошло списание.
 */
const PENDING_NOTE =
  "The change is with our payment provider. This page updates as soon as it confirms.";

/** Сколько ждать подтверждения провайдера, опрашивая экран. */
const CONFIRM_WAIT_MS = 60_000;

type SubscriptionSnapshot =
  | { status: string | null; cancelAtPeriodEnd: boolean; entitlements: { plan: string } }
  | undefined;

function snapshotKey(data: SubscriptionSnapshot): string {
  return data ? `${data.entitlements.plan}|${data.status}|${data.cancelAtPeriodEnd}` : "";
}

export function BillingView() {
  const [error, setError] = useState<string | null>(null);
  // Пока подтверждения нет, экран опрашивает сервер: вебхук приходит через
  // секунды после нажатия, и без опроса страница так и показывала бы
  // прежнее состояние.
  const [waiting, setWaiting] = useState<{ key: string; until: number } | null>(null);
  const isWaiting = (data: SubscriptionSnapshot) =>
    waiting !== null && Date.now() < waiting.until && snapshotKey(data) === waiting.key;

  const subscription = api.billing.subscription.useQuery(undefined, {
    refetchInterval: (query) => (isWaiting(query.state.data) ? 2_000 : false),
  });

  function begin() {
    setError(null);
    setWaiting(null);
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
    return <SkeletonCards count={2} />;
  }

  const { entitlements } = data;
  const busy =
    checkout.isPending || changePlan.isPending || cancel.isPending || resume.isPending;
  const currentRank = PLAN_ORDER.indexOf(entitlements.plan);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 rounded-lg border p-5">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <span data-testid="current-plan" className="text-lg font-medium">
            {PLAN_NAMES[entitlements.plan] ?? entitlements.plan}
          </span>
          <span className="metric text-sm text-muted-foreground">
            {data.clientsUsed} of {entitlements.clientLimit} clients ·{" "}
            {entitlements.aiCheckAllowance.toLocaleString("en-US")} AI checks a month
          </span>
        </div>

        <p data-testid="plan-reason" className="text-sm text-muted-foreground">
          {entitlements.reason}
        </p>

        {data.currentPeriodEnd && (
          <p className="metric text-sm text-muted-foreground">
            {data.cancelAtPeriodEnd ? "Ends" : "Renews"} on{" "}
            {new Date(data.currentPeriodEnd).toLocaleDateString()}.
          </p>
        )}
      </div>

      {data.status === "past_due" && (
        // Сбой списания — это ещё не отказ от продукта: у карты кончился
        // срок, банк отклонил разовый платёж. Отчёты клиентов агентства
        // всё это время продолжают открываться.
        <NotePanel testId="past-due-note" title="A payment did not go through">
          Update the card and the account keeps running. Your clients&rsquo; report links stay open
          while this is sorted out.
        </NotePanel>
      )}

      {!data.paymentsConfigured && (
        // Ни фальшивого checkout, ни кнопки, которая упадёт: пока провайдер
        // не подключён, продукт говорит это прямо.
        <p data-testid="payments-off" className="text-sm text-muted-foreground">
          Payments are not connected yet, so plans cannot be changed from here. The starter limits
          apply and everything else in the product works.
        </p>
      )}

      {isWaiting(data) && (
        <p data-testid="change-pending" className="text-sm text-muted-foreground">
          {PENDING_NOTE}
        </p>
      )}

      {error && (
        <p data-testid="form-error" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-3">
        {data.plans.map((plan) => {
          const current = plan.id === entitlements.plan;
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
              {data.paymentsConfigured && !current && !data.cancelAtPeriodEnd && (
                <button
                  type="button"
                  data-testid={`choose-${plan.id}`}
                  onClick={() => {
                    begin();
                    // Платящее агентство двигает существующую подписку:
                    // второй checkout означал бы второй счёт за тот же продукт.
                    if (data.hasLiveSubscription) {
                      changePlan.mutate({ plan: plan.id });
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

      {data.paymentsConfigured && data.hasLiveSubscription && (
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

      {data.paymentsConfigured && data.hasCustomer && (
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
          {/* Карта и счета живут у провайдера: продукт платёжных данных не хранит. */}
          <p className="text-sm text-muted-foreground">
            Card and invoices are handled by our payment provider.
          </p>
        </div>
      )}
    </div>
  );
}
