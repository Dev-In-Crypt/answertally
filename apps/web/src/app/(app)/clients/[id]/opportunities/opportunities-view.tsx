"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatPeriod, OPPORTUNITY_COPY, type Recommendation, recommendationSchema } from "@repo/core";
import { api, type RouterOutputs } from "@/trpc/react";
import { EmptyState } from "@/components/page-header";
import { ConfidenceBadge } from "@/components/ui/stat";
import { ScoreDial } from "@/components/ui/score";
import { NotePanel } from "@/components/ui/note-panel";
import { ProspectPanel } from "./prospect-panel";
import { PlanPanel } from "./plan-panel";
import { cn } from "@/lib/utils";
import { buttonClass } from "@/components/ui/button";
import { controlClass } from "@/components/ui/field";
import { SkeletonCards, SkeletonText } from "@/components/ui/skeleton";

type Opportunity = RouterOutputs["opportunities"]["list"][number];

const KIND_LABELS: Record<string, string> = {
  competitor_gap: "Competitor ahead",
  source_gap: "Missing from a cited source",
  content_gap: "Own content",
  cluster_gap: "Topic behind",
};

const PRIORITY_STYLE: Record<string, string> = {
  high: "border-competitor/50 text-competitor-ink",
  medium: "border-input text-foreground",
  low: "border-input text-muted-foreground",
};

function formatWindow(start: Date, end: Date): string {
  return formatPeriod(start, end);
}

export function OpportunitiesView({ clientId }: { clientId: string }) {
  const router = useRouter();
  const utils = api.useUtils();
  const opportunities = api.opportunities.list.useQuery({ clientId });
  const [openId, setOpenId] = useState<string | null>(null);

  const refresh = api.opportunities.refresh.useMutation({
    onSuccess: () => utils.opportunities.list.invalidate({ clientId }),
  });

  // «Клиент не найден» решает страница вокруг (opportunities/page.tsx), здесь — только список.
  if (opportunities.isPending) {
    return <SkeletonCards count={4} />;
  }

  if (opportunities.error && !opportunities.data) {
    return (
      <NotePanel title="Could not load opportunities" testId="form-error">
        {opportunities.error.message}{" "}
        <button className="underline" onClick={() => opportunities.refetch()}>
          Try again
        </button>
      </NotePanel>
    );
  }

  const rows = opportunities.data ?? [];
  const open = rows.filter((row) => row.status === "open");
  const decided = rows.filter((row) => row.status !== "open");

  return (
    <div className="flex flex-col gap-5">
      {/* У проспекта это ещё и экран продажи: что нашли, кого не отслеживают
          и как превратить в клиента, ничего не пересобирая. */}
      <ProspectPanel clientId={clientId} />

      {/* Пока находок нет, этой строки нет вовсе: пустое состояние ниже само
          зовёт запустить измерение, а кнопка пересчёта над ним висела бы
          сиротой рядом с пустым местом. */}
      {rows.length > 0 && (
      <div className="flex flex-wrap items-start justify-between gap-3">
        {/* Только счёт. «Ранжировано внутренней оценкой» уже сказано в
            описании страницы, и второй раз это просто шум. */}
        <p className="text-sm text-muted-foreground">{open.length} open</p>
        <div className="flex flex-col items-end gap-1">
          <button
            data-testid="refresh-opportunities"
            onClick={() => refresh.mutate({ clientId })}
            disabled={refresh.isPending}
            className={buttonClass("outline", "lg", "shrink-0")}
          >
            {refresh.isPending ? "Recomputing…" : "Recompute"}
          </button>
          {refresh.error && (
            <p role="alert" className="text-sm text-destructive">
              {refresh.error.message}
            </p>
          )}
        </div>
      </div>
      )}

      {rows.length === 0 ? (
        <EmptyState
          title={OPPORTUNITY_COPY.emptyTitle}
          description={OPPORTUNITY_COPY.emptyBody}
          action={
            <Link
              href={`/clients/${clientId}/measure`}
              className={buttonClass("primary", "lg")}
            >
              Run measurement
            </Link>
          }
        />
      ) : (
        <ul data-testid="opportunities-list" className="flex flex-col gap-3">
          {open.map((row) => (
            <OpportunityCard
              key={row.id}
              opportunity={row}
              expanded={openId === row.id}
              onToggle={() => setOpenId(openId === row.id ? null : row.id)}
              clientId={clientId}
              onConverted={() => {
                utils.opportunities.list.invalidate({ clientId });
                router.push(`/clients/${clientId}/actions`);
              }}
            />
          ))}
        </ul>
      )}

      {open.length > 0 && <PlanPanel clientId={clientId} />}

      {decided.length > 0 && (
        <details data-testid="decided-opportunities" className="rounded-lg border p-4">
          <summary className="cursor-pointer text-sm font-medium">
            Already decided ({decided.length})
          </summary>
          <ul className="mt-3 flex flex-col gap-2 text-sm">
            {decided.map((row) => (
              <li key={row.id} className="flex flex-wrap items-baseline gap-2">
                <span className="metric text-muted-foreground">{row.score}</span>
                <span>{row.title}</span>
                <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                  {row.status}
                </span>
                {row.dismissedReason && (
                  <span className="text-xs text-muted-foreground">— {row.dismissedReason}</span>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">{OPPORTUNITY_COPY.dismissReturns}</p>
        </details>
      )}
    </div>
  );
}

function OpportunityCard({
  opportunity,
  expanded,
  onToggle,
  clientId,
  onConverted,
}: {
  opportunity: Opportunity;
  expanded: boolean;
  onToggle: () => void;
  clientId: string;
  onConverted: () => void;
}) {
  return (
    <li data-testid="opportunity-card" className="min-w-0 rounded-lg border">
      <button
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full flex-col gap-2 p-4 text-left hover:bg-accent/40"
      >
        <div className="flex items-start gap-4">
          <ScoreDial score={opportunity.score} testId="opportunity-score" className="pt-0.5" />

          <span className="flex min-w-0 flex-col gap-2">
            <span className="break-words text-base font-medium">{opportunity.title}</span>

            <span
              data-testid="opportunity-reason"
              className="max-w-prose text-sm text-muted-foreground"
            >
              {opportunity.reason}
            </span>
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          <span
            className={cn(
              "rounded-full border px-2 py-0.5",
              PRIORITY_STYLE[opportunity.priority] ?? "",
            )}
          >
            {opportunity.priority} priority
          </span>
          <span className="rounded-full bg-secondary px-2 py-0.5 text-muted-foreground">
            {KIND_LABELS[opportunity.kind] ?? opportunity.kind}
          </span>
          <span className="text-muted-foreground">
            {opportunity.affectedPromptCount}{" "}
            {opportunity.affectedPromptCount === 1 ? "question" : "questions"} ·{" "}
            {opportunity.sampleCount} answers
          </span>
          <ConfidenceBadge level={opportunity.evidenceLevel} labelled />
        </div>
      </button>

      {expanded && (
        <OpportunityDetail
          opportunityId={opportunity.id}
          clientId={clientId}
          onConverted={onConverted}
        />
      )}
    </li>
  );
}

function OpportunityDetail({
  opportunityId,
  clientId,
  onConverted,
}: {
  opportunityId: string;
  clientId: string;
  onConverted: () => void;
}) {
  const utils = api.useUtils();
  const detail = api.opportunities.get.useQuery({ id: opportunityId });
  const evidence = api.opportunities.evidence.useQuery({ id: opportunityId });
  const [dismissReason, setDismissReason] = useState("");

  const convert = api.opportunities.convertToAction.useMutation({ onSuccess: onConverted });
  const decide = api.opportunities.decide.useMutation({
    onSuccess: () => utils.opportunities.list.invalidate({ clientId }),
  });

  if (detail.isPending) {
    return (
      <div className="border-t p-4">
        <SkeletonText lines={4} />
      </div>
    );
  }
  // После isPending данных нет только при ошибке; упавший фоновый перезапрос
  // оставляет загруженное на экране.
  if (!detail.data) {
    return (
      <p role="alert" className="border-t p-4 text-sm text-destructive">
        {detail.error?.message}
      </p>
    );
  }

  const breakdown = detail.data.scoreBreakdown as {
    factors: Record<string, number>;
    weights: Record<string, number>;
    version: number;
  };

  const recommendations = recommendationSchema
    .array()
    .safeParse(detail.data.recommendedActions);

  return (
    <div data-testid="opportunity-detail" className="flex min-w-0 flex-col gap-5 border-t p-4">
      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Why this score</h3>
        <ul data-testid="score-breakdown" className="flex flex-col gap-1.5">
          {(
            [
              ["impact", OPPORTUNITY_COPY.factorLabels.impact],
              ["coverage", OPPORTUNITY_COPY.factorLabels.coverage],
              ["commercialIntent", OPPORTUNITY_COPY.factorLabels.commercialIntent],
              ["actionability", OPPORTUNITY_COPY.factorLabels.actionability],
              ["confidence", OPPORTUNITY_COPY.factorLabels.confidence],
            ] as const
          ).map(([key, label]) => (
            // На узком экране подпись занимает всю строку, а полоса уходит
            // под неё: втроём в 375 пикселей они не помещаются и раздвигают
            // страницу шире экрана.
            <li key={key} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="w-full shrink-0 text-muted-foreground sm:w-52">{label}</span>
              <span className="h-1.5 w-24 shrink-0 overflow-hidden rounded-full bg-secondary sm:w-32">
                <span
                  className="block h-full bg-primary"
                  style={{ width: `${Math.round((breakdown.factors[key] ?? 0) * 100)}%` }}
                />
              </span>
              <span className="metric text-xs text-muted-foreground">
                {Math.round((breakdown.factors[key] ?? 0) * 100)}
              </span>
            </li>
          ))}
        </ul>
        <p className="max-w-prose text-xs text-muted-foreground">
          {OPPORTUNITY_COPY.scoreBasis} {OPPORTUNITY_COPY.coverageBasis}
        </p>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">Why am I seeing this?</h3>

        {evidence.isPending ? (
          <SkeletonText lines={3} />
        ) : evidence.error && !evidence.data ? (
          <p role="alert" className="text-sm text-destructive">
            {evidence.error.message}
          </p>
        ) : (
          <div data-testid="opportunity-evidence" className="flex flex-col gap-3 text-sm">
            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <dt className="text-xs text-muted-foreground">Window</dt>
                <dd className="metric" data-testid="evidence-window">
                  {formatWindow(evidence.data.window.start, evidence.data.window.end)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Answers measured</dt>
                <dd className="metric">{evidence.data.totalResponsesInWindow}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Questions affected</dt>
                <dd className="metric">{evidence.data.prompts.length}</dd>
              </div>
              <div>
                <dt className="text-xs text-muted-foreground">Evidence</dt>
                <dd>{evidence.data.evidenceLevel}</dd>
              </div>
            </dl>

            {evidence.data.prompts.length > 0 && (
              <ul data-testid="evidence-prompts" className="flex flex-col gap-1 break-words">
                {evidence.data.prompts.map((prompt) => (
                  <li key={prompt.id} className="text-muted-foreground">
                    <span className="text-foreground">{prompt.text}</span> · {prompt.clusterName}
                  </li>
                ))}
              </ul>
            )}

            {detail.data.competitorNames.length > 0 && (
              <p className="text-muted-foreground">
                Named in those answers: {detail.data.competitorNames.join(", ")}
              </p>
            )}

            {evidence.data.responses.length > 0 && (
              <details data-testid="evidence-answers">
                <summary className="cursor-pointer text-muted-foreground">
                  Example answers ({evidence.data.responses.length} of{" "}
                  {evidence.data.totalResponsesInWindow})
                </summary>
                <ul className="mt-2 flex flex-col gap-1 break-words text-xs text-muted-foreground">
                  {evidence.data.responses.map((response) => (
                    <li key={response.responseId}>
                      {response.platform} ·{" "}
                      {response.clientMentioned ? "client named" : "client not named"}
                      {response.competitorsMentioned.length > 0 &&
                        ` · ${response.competitorsMentioned.join(", ")}`}
                      {response.citedDomains.length > 0 && ` · ${response.citedDomains.join(", ")}`}
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">{evidence.data.basis}</p>
              </details>
            )}
          </div>
        )}
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-sm font-medium">What to do about it</h3>
        {recommendations.success ? (
          <ul data-testid="opportunity-actions" className="flex flex-col gap-2">
            {recommendations.data.map((recommendation: Recommendation, index: number) => (
              <li
                key={`${recommendation.rule}-${index}`}
                className="flex flex-col gap-2 rounded-lg border p-3"
              >
                <span className="font-medium">{recommendation.title}</span>
                <span className="max-w-prose text-sm text-muted-foreground">
                  {recommendation.reason}
                </span>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    data-testid="convert-opportunity"
                    onClick={() =>
                      convert.mutate({ id: opportunityId, recommendation })
                    }
                    disabled={convert.isPending}
                    className={buttonClass("primary", "md")}
                  >
                    {convert.isPending ? "Adding…" : "Create action"}
                  </button>
                  <span className="text-xs text-muted-foreground">
                    impact: {recommendation.estimatedImpact} · effort: {recommendation.effort}
                  </span>
                </div>
              </li>
            ))}
            {convert.error && (
              <li role="alert" className="text-sm text-destructive">
                {convert.error.message}
              </li>
            )}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">
            The stored recommendations could not be read. Recompute to rebuild them.
          </p>
        )}

        {detail.data.actions.length > 0 && (
          <p data-testid="opportunity-existing-actions" className="text-xs text-muted-foreground">
            Already in the queue: {detail.data.actions.map((action) => action.title).join(", ")}
          </p>
        )}
      </section>

      <section className="flex flex-col gap-2 rounded-lg border border-dashed p-3">
        <h3 className="text-sm font-medium">Not worth doing?</h3>
        <p className="max-w-prose text-xs text-muted-foreground">
          {OPPORTUNITY_COPY.dismissRequiresReason} {OPPORTUNITY_COPY.dismissReturns}
        </p>
        <textarea
          data-testid="dismiss-reason"
          value={dismissReason}
          onChange={(event) => setDismissReason(event.target.value)}
          rows={2}
          maxLength={500}
          className={cn(controlClass, "p-2.5")}
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            data-testid="dismiss-opportunity"
            disabled={dismissReason.trim().length === 0 || decide.isPending}
            onClick={() =>
              decide.mutate({
                id: opportunityId,
                status: "dismissed",
                dismissedReason: dismissReason.trim(),
              })
            }
            className={buttonClass("outline", "md")}
          >
            Dismiss
          </button>

          {/* Отложить — отдельное решение и без причины: «сейчас не до этого»
              не то же самое, что «этого мы не делаем», и через месяц пункт
              вернётся сам. */}
          <button
            data-testid="snooze-opportunity"
            disabled={decide.isPending}
            onClick={() =>
              decide.mutate({
                id: opportunityId,
                status: "snoozed",
                snoozedUntil: new Date(Date.now() + 30 * 86_400_000),
              })
            }
            className={buttonClass("ghost", "md")}
          >
            {OPPORTUNITY_COPY.snoozeLabel}
          </button>
        </div>
        <p className="text-xs text-muted-foreground">{OPPORTUNITY_COPY.snoozeNote}</p>
        {decide.error && (
          <p role="alert" data-testid="form-error" className="text-sm text-destructive">
            {decide.error.message}
          </p>
        )}
      </section>
    </div>
  );
}
