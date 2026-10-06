"use client";

import { useState } from "react";
import Link from "next/link";
import { ASSISTANTS, billingPeriod } from "@repo/core";
import { api } from "@/trpc/react";
import { EmptyState } from "@/components/page-header";
import { NotePanel } from "@/components/ui/note-panel";
import { controlClass } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { Wallet } from "lucide-react";

/**
 * Расход тарифа: сколько проверок ушло и на что.
 *
 * В долларах здесь ничего нет намеренно. Сколько ответ стоит нам — наша
 * цифра, а не агентства: агентство платит за тариф, и решать ему надо в
 * проверках — сколько их даёт план, сколько съел какой клиент и какой
 * ассистент. Доллары на этом экране отвечали бы на вопрос, которого
 * агентство не задаёт, и открывали бы нашу себестоимость.
 *
 * Настоящая цена каждого ответа по-прежнему пишется на сам ответ — она
 * нужна нам для тарифов, просто не показывается здесь.
 */

// Подписи берутся из каталога: новый ассистент не требует правки в каждом экране.
const PLATFORM_LABELS: Record<string, string> = Object.fromEntries(
  ASSISTANTS.map((assistant) => [assistant.id, assistant.label]),
);

/** Последние 12 периодов: дальше в прошлое смотреть незачем, а список короткий. */
function recentPeriods(count = 12): string[] {
  const now = new Date();
  return Array.from({ length: count }, (_, index) =>
    billingPeriod(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - index, 1))),
  );
}

export function UsageView() {
  const [period, setPeriod] = useState(() => billingPeriod());
  const costs = api.billing.costs.useQuery({ period });
  const usage = api.billing.usage.useQuery({ period });

  const data = costs.data;
  const allowance = usage.data?.aiChecks;

  // Разбор по клиентам — финансы всего агентства, member их не видит. Без
  // этой ветки он получал прочерки и пустые таблицы, похожие на «ничего не потрачено».
  if (costs.error) {
    return costs.error.data?.code === "FORBIDDEN" ? (
      <NotePanel title="Only the owner and admins see this breakdown" testId="usage-admin-only">
        Where the checks went is visible to the agency owner and admins.{" "}
        <Link href="/settings/billing" className="text-primary underline">
          Plan and usage
        </Link>{" "}
        shows how much of the plan is used.
      </NotePanel>
    ) : (
      <NotePanel title="Could not load usage" testId="form-error">
        {costs.error.message}{" "}
        <button type="button" className="underline" onClick={() => costs.refetch()}>
          Try again
        </button>
      </NotePanel>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <label htmlFor="period" className="text-sm text-muted-foreground">
          Billing period
        </label>
        <select
          id="period"
          data-testid="usage-period"
          value={period}
          onChange={(event) => setPeriod(event.target.value)}
          className={cn(controlClass, "h-10 px-2.5")}
        >
          {recentPeriods().map((value) => (
            <option key={value} value={value}>
              {value}
            </option>
          ))}
        </select>
      </div>

      {data && data.fixtureAnswers > 0 && (
        <p data-testid="usage-fixtures" className="text-sm text-muted-foreground">
          {/* Прогоны на фикстурах не стоят проверок: показывать их в расходе
              значило бы называть израсходованным то, чего не было. */}
          <span className="metric">{data.fixtureAnswers}</span> answers in this period came from
          fixtures. No assistant was asked and nothing was counted, so they are not in the totals
          below.
        </p>
      )}

      {data && data.rows.length === 0 ? (
        <EmptyState
          title="No checks used in this period"
          icon={Wallet}
          description="Checks appear once measurement has run against the live assistants. Every answer is counted as it happens, so this page always matches the raw responses."
        />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1 rounded-lg border p-5">
              <span className="text-sm text-muted-foreground">Checks used</span>
              <span data-testid="usage-total" className="metric text-3xl font-semibold tracking-tight">
                {data ? data.totalResponses.toLocaleString("en-US") : "–"}
              </span>
              {allowance && (
                <span
                  className={cn(
                    "text-sm",
                    allowance.overAllowance ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  {/* Число выше — за выбранный месяц, а бесплатный аудит считается за всё
                      время: рядом с месячным числом его остаток читался бы неверно. */}
                  {allowance.free ? (
                    <>
                      <span className="metric">{allowance.used.toLocaleString("en-US")}</span> of
                      the <span className="metric">{allowance.allowance.toLocaleString("en-US")}</span>{" "}
                      free checks used in total
                    </>
                  ) : (
                    <>
                      {allowance.overAllowance ? "Above the " : "of the "}
                      <span className="metric">{allowance.allowance.toLocaleString("en-US")}</span>{" "}
                      this plan includes
                    </>
                  )}
                </span>
              )}
            </div>
            <div className="flex flex-col gap-1 rounded-lg border p-5">
              <span className="text-sm text-muted-foreground">
                {allowance?.free ? "Share of the free audit" : "Share of the plan"}
              </span>
              <span
                data-testid="usage-share"
                className="metric text-3xl font-semibold tracking-tight"
              >
                {allowance ? `${Math.round(allowance.ratio * 100)}%` : "–"}
              </span>
              <span className="text-sm text-muted-foreground">
                {/* Лимит — потолок: так же сказано на странице тарифов. Бесплатный
                    аудит первого числа не обновляется — он один на аккаунт. */}
                {allowance?.free
                  ? "The free audit is one per account. At 100%, pick a plan to keep measuring."
                  : "At 100%, new checks wait until the 1st. Running ones always finish."}
              </span>
            </div>
          </div>

          <div className="flex flex-col gap-3">
            <h2 className="text-lg font-medium">By client</h2>
            <table data-testid="usage-by-client" className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 font-medium">Client</th>
                  <th className="py-2 text-right font-medium">Checks</th>
                  <th className="py-2 text-right font-medium">Share</th>
                </tr>
              </thead>
              <tbody>
                {(data?.clients ?? []).map((row) => (
                  <tr key={row.clientId} className="border-b last:border-0">
                    <td className="py-2">{row.clientName}</td>
                    <td
                      data-testid={`usage-client-${row.clientId}`}
                      className="metric py-2 text-right"
                    >
                      {row.responses.toLocaleString("en-US")}
                    </td>
                    <td className="metric py-2 text-right text-muted-foreground">
                      {data && data.totalResponses > 0
                        ? `${Math.round((row.responses / data.totalResponses) * 100)}%`
                        : "–"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-col gap-3">
            <h2 className="text-lg font-medium">By client and assistant</h2>
            <table data-testid="usage-by-platform" className="w-full text-sm">
              <thead className="text-left text-muted-foreground">
                <tr className="border-b">
                  <th className="py-2 font-medium">Client</th>
                  <th className="py-2 font-medium">Assistant</th>
                  <th className="py-2 text-right font-medium">Checks</th>
                </tr>
              </thead>
              <tbody>
                {(data?.rows ?? []).map((row) => (
                  <tr key={`${row.clientId}-${row.platform}`} className="border-b last:border-0">
                    <td className="py-2">{row.clientName}</td>
                    <td className="py-2">{PLATFORM_LABELS[row.platform] ?? row.platform}</td>
                    <td className="metric py-2 text-right">
                      {row.responses.toLocaleString("en-US")}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
