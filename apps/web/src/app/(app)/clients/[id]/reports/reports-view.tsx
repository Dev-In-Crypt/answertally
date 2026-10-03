"use client";

import { useEffect, useState } from "react";
import { PROPOSAL_DEFAULTS } from "@repo/core";
import { api } from "@/trpc/react";
import { reportUrl } from "@/app/r/report-url";
import { EmptyState } from "@/components/page-header";
import { buttonClass } from "@/components/ui/button";
import { controlClass, inputClass } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { FileText } from "lucide-react";

export function ReportsView({ clientId }: { clientId: string }) {
  const utils = api.useUtils();
  const client = api.clients.get.useQuery({ id: clientId });
  const reports = api.reports.list.useQuery({ clientId });
  const [shareLinks, setShareLinks] = useState<Record<string, string>>({});
  const [sending, setSending] = useState<string | null>(null);
  const [sentTo, setSentTo] = useState<Record<string, string>>({});

  /**
   * Ссылку отсюда копируют и отдают клиенту, поэтому она должна быть
   * целой, а не путём. Origin берётся после монтирования: на сервере его
   * в клиентском коде нет, а расхождение разметки ломало бы гидратацию.
   * Свой домен отчётов (если он настроен) `reportUrl` подставит и без него.
   */
  const [origin, setOrigin] = useState("");
  useEffect(() => setOrigin(window.location.origin), []);

  const generate = api.reports.generate.useMutation({
    onSuccess: async () => {
      await utils.reports.list.invalidate({ clientId });
    },
  });

  const share = api.reports.share.useMutation({
    onSuccess: async (result, variables) => {
      setShareLinks((current) => ({ ...current, [variables.reportId]: result.token }));
      await utils.reports.list.invalidate({ clientId });
    },
  });

  // Пересланная ссылка открывала бы отчёт клиента — с конкурентами — пока
  // её не отзовут; сама она живёт 90 дней.
  const revoke = api.reports.revokeShare.useMutation({
    onSuccess: async (_result, variables) => {
      setShareLinks((current) => {
        const next = { ...current };
        delete next[variables.reportId];
        return next;
      });
      await utils.reports.list.invalidate({ clientId });
    },
  });

  const rows = reports.data ?? [];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <button
          type="button"
          data-testid="generate-report"
          disabled={generate.isPending}
          onClick={() => generate.mutate({ clientId })}
          className={buttonClass("primary", "lg")}
        >
          {generate.isPending ? "Generating…" : "Generate report"}
        </button>
        <span className="text-sm text-muted-foreground">
          Covers the last 30 days. Numbers are frozen at generation time.
        </span>
      </div>

      {client.data?.status === "prospect" && (
        <OpportunityForm
          clientId={clientId}
          onGenerated={() => utils.reports.list.invalidate({ clientId })}
        />
      )}

      {rows.length === 0 ? (
        <EmptyState
          title="No reports yet"
          icon={FileText}
          description="A report gathers the period's measurements, the work completed and what is planned next, in a page you can send to the client as-is."
        />
      ) : (
        <ul data-testid="reports-list" className="flex flex-col gap-3">
          {rows.map((report) => {
            const token = shareLinks[report.id];

            return (
              <li key={report.id} className="flex flex-col gap-2 rounded-lg border p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <span className="metric text-sm">
                    {new Date(report.periodStart).toISOString().slice(0, 10)} —{" "}
                    {new Date(report.periodEnd).toISOString().slice(0, 10)}
                  </span>
                  <span className="flex items-center gap-3">
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
                      {report.status}
                    </span>
                    <a
                      href={`/api/reports/${report.id}/pdf`}
                      data-testid={`pdf-${report.id}`}
                      className={buttonClass("outline", "md")}
                    >
                      Download PDF
                    </a>
                    <button
                      type="button"
                      data-testid={`share-${report.id}`}
                      disabled={share.isPending}
                      onClick={() => share.mutate({ reportId: report.id })}
                      className={buttonClass("outline", "md")}
                    >
                      Get client link
                    </button>
                    <button
                      type="button"
                      data-testid={`send-${report.id}`}
                      onClick={() => setSending(sending === report.id ? null : report.id)}
                      className={buttonClass("outline", "md")}
                    >
                      Send to client
                    </button>
                  </span>
                </div>

                {sending === report.id && (
                  <SendReport
                    reportId={report.id}
                    onSent={(to) => {
                      setSentTo((current) => ({ ...current, [report.id]: to }));
                      setSending(null);
                    }}
                    onCancel={() => setSending(null)}
                  />
                )}

                {sentTo[report.id] && (
                  <p data-testid="send-done" className="text-sm text-muted-foreground">
                    Sent to <span className="metric">{sentTo[report.id]}</span>. The client opens
                    the report by link — no account needed, and approves it there.
                  </p>
                )}

                {token && (
                  <p data-testid="share-link" className="break-all text-sm text-muted-foreground">
                    {/* Ссылка показывается целиком: агентство отправит её само,
                        автоматической рассылки в продукте нет. */}
                    <a
                      href={reportUrl(token, { origin })}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="text-primary underline-offset-4 hover:underline"
                    >
                      {reportUrl(token, { origin })}
                    </a>{" "}
                    <button
                      type="button"
                      data-testid={`revoke-${report.id}`}
                      disabled={revoke.isPending}
                      onClick={() => revoke.mutate({ reportId: report.id })}
                      className={buttonClass("ghost", "sm")}
                    >
                      Revoke link
                    </button>
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * Отчёт по бесплатному аудиту.
 *
 * Ретейнер, часы и стоимость часа вводит агентство: продукт их не знает и
 * подставлять «рыночные» значения не должен. Маржа считается тут же, но
 * остаётся внутренней — в клиентский отчёт она не попадает.
 */
function OpportunityForm({
  clientId,
  onGenerated,
}: {
  clientId: string;
  onGenerated: () => Promise<void> | void;
}) {
  const [retainer, setRetainer] = useState<number>(PROPOSAL_DEFAULTS.retainerUsd);
  const [effortMin, setEffortMin] = useState<number>(PROPOSAL_DEFAULTS.effortHours.min);
  const [effortMax, setEffortMax] = useState<number>(PROPOSAL_DEFAULTS.effortHours.max);
  const [hourlyCost, setHourlyCost] = useState<number>(PROPOSAL_DEFAULTS.hourlyCostUsd);

  const generate = api.reports.generateOpportunity.useMutation({
    onSuccess: async () => {
      await onGenerated();
    },
  });

  const margin =
    retainer > 0
      ? {
          min: Math.round(((retainer - effortMax * hourlyCost) / retainer) * 1000) / 10,
          max: Math.round(((retainer - effortMin * hourlyCost) / retainer) * 1000) / 10,
        }
      : null;

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-dashed p-4">
      <h2 className="text-base font-medium">Opportunity report (audit)</h2>
      <p className="max-w-prose text-sm text-muted-foreground">
        Shows where this prospect stands today, the ranked work behind it and what you propose to
        charge. Your margin stays here — the client report never shows it.
      </p>

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Retainer, $ / month</span>
          <input
            type="number"
            min={1}
            aria-label="Retainer"
            value={retainer}
            onChange={(event) => setRetainer(Number(event.target.value))}
            className={`${inputClass} w-32`}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Effort, hours from</span>
          <input
            type="number"
            min={1}
            aria-label="Effort hours minimum"
            value={effortMin}
            onChange={(event) => setEffortMin(Number(event.target.value))}
            className={`${inputClass} w-24`}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">to</span>
          <input
            type="number"
            min={1}
            aria-label="Effort hours maximum"
            value={effortMax}
            onChange={(event) => setEffortMax(Number(event.target.value))}
            className={`${inputClass} w-24`}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Your cost, $ / hour</span>
          <input
            type="number"
            min={1}
            aria-label="Hourly cost"
            value={hourlyCost}
            onChange={(event) => setHourlyCost(Number(event.target.value))}
            className={`${inputClass} w-28`}
          />
        </label>
        <button
          type="button"
          data-testid="generate-opportunity"
          disabled={generate.isPending || effortMin > effortMax}
          onClick={() =>
            generate.mutate({
              clientId,
              retainerUsd: retainer,
              effortHoursMin: effortMin,
              effortHoursMax: effortMax,
              hourlyCostUsd: hourlyCost,
            })
          }
          className={buttonClass("primary", "lg")}
        >
          {generate.isPending ? "Generating…" : "Generate opportunity report"}
        </button>
      </div>

      {margin && (
        <p data-testid="opportunity-margin" className="metric text-sm text-muted-foreground">
          Estimated margin: {margin.min}%–{margin.max}% (internal)
        </p>
      )}

      {effortMin > effortMax && (
        <p data-testid="form-error" className="text-sm text-destructive">
          The effort range is inverted — the lower bound is above the upper one.
        </p>
      )}

      {generate.error && (
        <p data-testid="form-error" className="text-sm text-destructive">
          {generate.error.message}
        </p>
      )}
    </section>
  );
}

/**
 * Отправка отчёта клиенту агентства.
 *
 * Явное действие человека, по одному адресу за раз: рассылок в продукте нет
 * и не планируется (инвариант 4). Письмо несёт ссылку, а не сам документ —
 * отчёт живёт на своей странице, где его можно согласовать.
 */
function SendReport({
  reportId,
  onSent,
  onCancel,
}: {
  reportId: string;
  /** Подтверждение показывает родитель: форма после отправки закрывается. */
  onSent: (to: string) => void;
  onCancel: () => void;
}) {
  const [to, setTo] = useState("");
  const [note, setNote] = useState("");

  const send = api.reports.send.useMutation({
    onSuccess: (_result, variables) => {
      onSent(variables.to);
    },
  });

  return (
    <div className="flex flex-col gap-2 rounded-md border border-dashed p-3">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Client email</span>
        <input
          type="email"
          value={to}
          onChange={(event) => setTo(event.target.value)}
          placeholder="finance@ledgerbrook.test"
          className={inputClass}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Note (optional)</span>
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value)}
          rows={2}
          placeholder="Anything you want to say in your own words"
          className={cn(controlClass, "p-2.5")}
        />
      </label>

      {send.error && (
        <p data-testid="form-error" className="text-sm text-destructive">
          {send.error.message}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          data-testid="confirm-send"
          disabled={!to.includes("@") || send.isPending}
          onClick={() =>
            send.mutate({ reportId, to: to.trim(), ...(note.trim() ? { note: note.trim() } : {}) })
          }
          className={buttonClass("primary", "md")}
        >
          {send.isPending ? "Sending…" : "Send"}
        </button>
        <button type="button" onClick={onCancel} className={buttonClass("outline", "md")}>
          Cancel
        </button>
      </div>

      {/* Письмо уходит от имени агентства: названия продукта в нём нет. */}
      <p className="text-xs text-muted-foreground">
        The email is signed with your agency name and carries a link, not an attachment.
      </p>
    </div>
  );
}
