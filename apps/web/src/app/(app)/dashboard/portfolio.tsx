"use client";

import Link from "next/link";
import { CONFIDENCE_LABELS, MEASUREMENT_COPY } from "@repo/core";
import { api } from "@/trpc/react";
import { EmptyState } from "@/components/page-header";
import { cn } from "@/lib/utils";
import { ASK_ADMIN_TO_ADD_CLIENT } from "@/lib/role";
import { useCan } from "@/lib/role-context";
import { buttonClass } from "@/components/ui/button";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";
import { Users } from "lucide-react";

/**
 * Портфель — все клиенты одной таблицей.
 *
 * Стоит под лентой решений и отвечает на второй вопрос: как в целом идут дела.
 * Клиент, не набравший порог сэмплов, показывает прочерк: число в этой клетке
 * было бы догадкой, а по портфелю решают, кому уделить неделю.
 */

function formatPct(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)}%`;
}

function formatPp(value: number | null): string {
  if (value === null) return "—";
  return `${value > 0 ? "+" : ""}${value} pp`;
}

export function Portfolio() {
  const portfolio = api.clients.portfolio.useQuery();
  const rows = portfolio.data ?? [];
  const canAddClient = useCan("admin");

  if (portfolio.isPending) {
    return <SkeletonRows rows={6} />;
  }

  /**
   * Ошибка не должна выглядеть как «клиентов нет».
   * Пустое состояние — утверждение о данных; показывать его вместо сбоя
   * значит врать о состоянии портфеля, и агентство решит, что всё потеряно.
   * Упавшее фоновое обновление уже загруженную таблицу не стирает.
   */
  if (portfolio.error && !portfolio.data) {
    return (
      <div
        role="alert"
        data-testid="form-error"
        className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-8"
      >
        <h2 className="text-base font-medium">The portfolio could not be loaded</h2>
        <p className="max-w-prose text-sm text-muted-foreground">{portfolio.error.message}</p>
        <button onClick={() => portfolio.refetch()} className={buttonClass("outline", "lg")}>
          Try again
        </button>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No clients yet"
        icon={Users}
        description={
          canAddClient
            ? "Add your first client to start measuring how often AI assistants mention them, and where competitors show up instead."
            : ASK_ADMIN_TO_ADD_CLIENT
        }
        action={
          canAddClient && (
            <Link href="/clients/new" className={buttonClass("primary", "lg")}>
              Add client
            </Link>
          )
        }
      />
    );
  }

  const thin = rows.filter((row) => !row.sufficient).length;

  return (
    <div className="flex flex-col gap-3">
      <Table testId="portfolio-table" minWidth={720}>
        <THead>
          <TH>Client</TH>
          <TH align="right">Named in</TH>
          <TH align="right">Gap to best</TH>
          <TH align="right">Change</TH>
          <TH>Confidence</TH>
          <TH>Needs you</TH>
        </THead>
        <tbody>
          {rows.map((row) => (
            <TR key={row.clientId}>
              <TD>
                <Link
                  href={`/clients/${row.clientId}`}
                  className="flex flex-col underline-offset-4 hover:underline"
                >
                  <span className="font-medium">{row.name}</span>
                  <span className="text-xs text-muted-foreground">{row.domain}</span>
                </Link>
              </TD>
              <TD
                numeric
                align="right"
                data-testid={`portfolio-pct-${row.clientId}`}
                className="font-medium"
              >
                {formatPct(row.visibilityPct)}
              </TD>
              <TD numeric align="right" className="text-competitor-ink">
                {formatPp(row.gapPp)}
              </TD>
              <TD
                numeric
                align="right"
                className={cn(
                  row.deltaPp === null && "text-muted-foreground",
                  row.deltaPp !== null && row.deltaPp > 0 && "text-client-ink",
                  row.deltaPp !== null && row.deltaPp < 0 && "text-competitor-ink",
                )}
                /* Прочерк без причины читается как поломка экрана. */
                title={
                  row.deltaBasis === "same" ? undefined : MEASUREMENT_COPY.assistantSetChanged
                }
              >
                <span
                  data-testid={row.deltaBasis === "same" ? undefined : "portfolio-basis-changed"}
                >
                  {formatPp(row.deltaPp)}
                </span>
              </TD>
              <TD>
                <span
                  className={cn(
                    "metric rounded-full px-2 py-1 text-[11px] font-medium",
                    row.confidence === "low"
                      ? "bg-competitor/12 text-competitor-ink"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {row.confidence} · {row.sampleCount} samples
                </span>
              </TD>
              <TD>
                {row.needs.length === 0 ? (
                  <span className="text-muted-foreground">—</span>
                ) : (
                  <Link
                    href={`/clients/${row.clientId}`}
                    className="font-medium text-primary underline-offset-4 hover:underline"
                  >
                    {row.needs.join(" · ")}
                  </Link>
                )}
              </TD>
            </TR>
          ))}
        </tbody>
      </Table>

      {thin > 0 && (
        <p data-testid="portfolio-thin" className="text-sm text-muted-foreground">
          {thin} {thin === 1 ? "client shows" : "clients show"} a dash instead of a number.{" "}
          {MEASUREMENT_COPY.underFloor}
        </p>
      )}

      <p className="text-sm text-muted-foreground">
        {CONFIDENCE_LABELS.medium} and above means the share is readable; below it, treat the row as
        a direction rather than a figure.
      </p>
    </div>
  );
}
