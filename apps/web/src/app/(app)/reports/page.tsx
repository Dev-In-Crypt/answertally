"use client";

import Link from "next/link";
import { FileText } from "lucide-react";
import { api } from "@/trpc/react";
import { EmptyState, PageHeader } from "@/components/page-header";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { SkeletonRows } from "@/components/ui/skeleton";
import { Table, TD, TH, THead, TR } from "@/components/ui/table";

/**
 * Отчёты всего агентства.
 *
 * «Пять отчётов ждут согласования» на главной должно куда-то приводить.
 * Раньше приводило к клиенту, и чтобы собрать общую картину, приходилось
 * обойти всех по одному. Здесь один список: у кого, за какой период, в каком
 * состоянии и чего ждёт.
 */

const STATUS_TONE = {
  draft: "muted",
  shared: "neutral",
  approved: "client",
} as const;

function period(start: Date, end: Date): string {
  const format = (date: Date) =>
    new Date(date).toLocaleDateString("en-US", { month: "short", day: "numeric" });
  return `${format(start)} – ${format(end)}`;
}

export default function AgencyReportsPage() {
  const reports = api.reports.listForAgency.useQuery();
  const rows = reports.data ?? [];
  const awaiting = rows.filter((row) => row.awaitingApproval).length;

  return (
    <>
      <PageHeader
        title="Reports"
        description="Every client report in one place. Nothing reaches a client until a person approves it."
      />

      {reports.isPending ? (
        <SkeletonRows rows={6} />
      ) : reports.error && !reports.data ? (
        // Пустое состояние — утверждение о данных: показать его вместо сбоя
        // значит сказать «отчётов нет», когда на деле их не удалось загрузить.
        // Сбой фонового обновления уже загруженный список не прячет.
        <div
          role="alert"
          data-testid="form-error"
          className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-8"
        >
          <h2 className="text-base font-medium">Reports could not be loaded</h2>
          <p className="max-w-prose text-sm text-muted-foreground">{reports.error.message}</p>
          <button onClick={() => reports.refetch()} className={buttonClass("outline", "lg")}>
            Try again
          </button>
        </div>
      ) : rows.length === 0 ? (
        <EmptyState
          title="No reports yet"
          icon={FileText}
          description="Reports are built from a client's measured window. Open a client and generate one once a run has finished."
          action={
            <Link href="/clients" className={buttonClass("primary", "lg")}>
              Go to clients
            </Link>
          }
        />
      ) : (
        <div className="flex flex-col gap-3">
          {awaiting > 0 && (
            <p className="text-sm text-muted-foreground">
              {awaiting} {awaiting === 1 ? "report is" : "reports are"} shared with a client and
              waiting on their approval.
            </p>
          )}

          <Table testId="agency-reports-table" minWidth={640}>
            <THead>
              <TH>Client</TH>
              <TH>Period</TH>
              <TH>Status</TH>
              <TH>Waiting for</TH>
            </THead>
            <tbody>
              {rows.map((row) => (
                <TR key={row.id}>
                  <TD>
                    <Link
                      href={`/clients/${row.clientId}/reports`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {row.clientName}
                    </Link>
                  </TD>
                  <TD numeric className="text-muted-foreground">
                    {period(row.periodStart, row.periodEnd)}
                  </TD>
                  <TD>
                    <Badge tone={STATUS_TONE[row.status]}>{row.status}</Badge>
                  </TD>
                  <TD className="text-muted-foreground">
                    {row.awaitingApproval
                      ? "The client to approve it"
                      : row.status === "draft"
                        ? "You to review and share it"
                        : "Nothing"}
                  </TD>
                </TR>
              ))}
            </tbody>
          </Table>
        </div>
      )}
    </>
  );
}
