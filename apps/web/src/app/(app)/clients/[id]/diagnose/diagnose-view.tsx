"use client";

import { useState } from "react";
import { keepPreviousData } from "@tanstack/react-query";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { api } from "@/trpc/react";
import { EmptyState } from "@/components/page-header";
import { buttonClass } from "@/components/ui/button";
import { SkeletonCards } from "@/components/ui/skeleton";
import { Quote } from "lucide-react";

/** Цвета типов источников: собственные — зелёным, всё стороннее — оттенками оранжевого. */
const TYPE_COLORS: Record<string, string> = {
  owned: "var(--color-client)",
  editorial: "var(--color-competitor)",
  review: "oklch(0.68 0.15 70)",
  directory: "oklch(0.62 0.12 40)",
  ugc: "oklch(0.72 0.10 90)",
  social: "oklch(0.66 0.09 110)",
  documentation: "oklch(0.60 0.08 200)",
  product_feed: "oklch(0.64 0.10 300)",
  inaccessible: "var(--color-destructive)",
  other: "var(--color-muted-foreground)",
  unclassified: "var(--color-border)",
};

const TYPE_LABELS: Record<string, string> = {
  owned: "Owned",
  editorial: "Editorial",
  review: "Review platforms",
  directory: "Directories",
  ugc: "Community / UGC",
  social: "Social",
  documentation: "Documentation",
  product_feed: "Product feeds",
  inaccessible: "Unreachable",
  other: "Other",
  unclassified: "Not classified yet",
};

type RecommendationPayload = Parameters<
  ReturnType<typeof api.actions.convertFromRecommendation.useMutation>["mutate"]
>[0]["recommendation"];

/** Превращает рекомендацию в действие. Повторный клик дубль не создаёт. */
function CreateActionButton({
  clientId,
  recommendation,
}: {
  clientId: string;
  recommendation: RecommendationPayload;
}) {
  const utils = api.useUtils();
  const convert = api.actions.convertFromRecommendation.useMutation({
    onSuccess: async () => {
      await utils.actions.list.invalidate({ clientId });
    },
  });

  const done = convert.isSuccess;

  return (
    <div className="flex shrink-0 flex-col items-end gap-1">
      <button
        type="button"
        data-testid="create-action"
        disabled={convert.isPending || done}
        onClick={() => convert.mutate({ clientId, recommendation })}
        className={buttonClass("outline", "md", "shrink-0")}
      >
        {done ? "Added to actions" : convert.isPending ? "Adding…" : "Create action"}
      </button>
      {convert.error && (
        <p role="alert" className="max-w-56 text-right text-xs text-destructive">
          {convert.error.message}
        </p>
      )}
    </div>
  );
}

export function DiagnoseView({ clientId }: { clientId: string }) {
  const [clusterId, setClusterId] = useState<string | null>(null);

  const clusters = api.prompts.clusters.useQuery({ clientId });
  // Смена кластера не стирает экран до скелетона: прежние данные стоят,
  // пока грузятся новые, и селектор не исчезает из-под руки.
  const graph = api.diagnosis.sourceGraph.useQuery(
    { clientId, clusterId },
    { placeholderData: keepPreviousData },
  );
  const recommendations = api.diagnosis.recommendations.useQuery(
    { clientId, clusterId },
    { placeholderData: keepPreviousData },
  );
  const opportunities = api.opportunities.list.useQuery({ clientId });

  /**
   * Источник, у которого есть посчитанная возможность, показывает её оценку.
   * «Reddit процитирован 17 раз» — наблюдение; «Reddit, 91» — приоритет, и
   * именно за приоритетом агентство сюда приходит.
   */
  const scoreByDomain = new Map(
    (opportunities.data ?? [])
      .filter((row) => row.sourceDomain !== null && row.status === "open")
      .map((row) => [row.sourceDomain as string, row.score]),
  );

  if (graph.isPending) {
    return <SkeletonCards count={2} />;
  }

  const data = graph.data;

  const clusterSelect = (
    <select
      aria-label="Cluster"
      value={clusterId ?? ""}
      onChange={(e) => setClusterId(e.target.value || null)}
      className="h-9 shrink-0 rounded-md border border-input bg-background px-2 text-sm"
    >
      <option value="">All clusters</option>
      {(clusters.data ?? []).map((cluster) => (
        <option key={cluster.id} value={cluster.id}>
          {cluster.name}
        </option>
      ))}
    </select>
  );

  // Сбой — не «источников нет»: пустое состояние отправило бы запускать
  // проверку, хотя прогоны есть, а не загрузился экран.
  if (graph.error) {
    return (
      <div className="flex flex-col gap-4">
        {clusterId && <div className="flex justify-end">{clusterSelect}</div>}
        <div
          role="alert"
          data-testid="form-error"
          className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-8"
        >
          <h2 className="text-base font-medium">Diagnosis could not be loaded</h2>
          <p className="max-w-prose text-sm text-muted-foreground">{graph.error.message}</p>
          <button
            type="button"
            onClick={() => graph.refetch()}
            className={buttonClass("outline", "lg")}
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!data || data.influential.length === 0) {
    // Пустой кластер — не пустой клиент: селектор остаётся, чтобы вернуться.
    if (clusterId) {
      return (
        <div className="flex flex-col gap-4">
          <div className="flex justify-end">{clusterSelect}</div>
          <EmptyState
            title="No sources cited for this cluster"
            icon={Quote}
            description="Answers to this cluster's prompts named no sources yet. Other clusters may still have them."
            action={
              <button
                type="button"
                onClick={() => setClusterId(null)}
                className={buttonClass("outline", "md")}
              >
                Show all clusters
              </button>
            }
          />
        </div>
      );
    }
    return (
      <EmptyState
        title="No cited sources yet"
        icon={Quote}
        description="Run a check from the Measure screen. Diagnosis reads the sources models actually cited, so it needs at least one completed run."
      />
    );
  }

  const ownedShare = data.mix.find((entry) => entry.sourceType === "owned")?.sharePct ?? 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between gap-3">
        <p data-testid="diagnosis-statement" className="max-w-prose text-sm">
          {data.statement}{" "}
          <span className="text-muted-foreground">{data.evidenceNote}</span>
        </p>
        {clusterSelect}
      </div>

      <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
        <section className="flex flex-col gap-3 rounded-lg border p-4">
          <h2 className="text-base font-medium">Where answers come from</h2>

          <div data-testid="source-mix-chart" className="h-56">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data.mix.map((entry) => ({
                    name: TYPE_LABELS[entry.sourceType] ?? entry.sourceType,
                    value: entry.citations,
                    sharePct: entry.sharePct,
                  }))}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={45}
                  outerRadius={80}
                  paddingAngle={2}
                >
                  {data.mix.map((entry) => (
                    <Cell
                      key={entry.sourceType}
                      fill={TYPE_COLORS[entry.sourceType] ?? "var(--color-muted-foreground)"}
                    />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{
                    background: "var(--color-popover)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          <ul data-testid="source-mix-list" className="flex flex-col gap-1 text-sm">
            {data.mix.map((entry) => (
              <li key={entry.sourceType} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="inline-block size-2.5 rounded-sm"
                    style={{
                      background: TYPE_COLORS[entry.sourceType] ?? "var(--color-muted-foreground)",
                    }}
                  />
                  {TYPE_LABELS[entry.sourceType] ?? entry.sourceType}
                </span>
                <span className="metric text-muted-foreground">{entry.sharePct}%</span>
              </li>
            ))}
          </ul>

          {/* Доля собственных страниц — единственная честная причина, почему
              план «напишем ещё статей» не сдвинет эти цифры. */}
          <p data-testid="owned-share" className="text-sm text-muted-foreground">
            Owned pages carry <span className="metric">{ownedShare}%</span> of citations here.
            {ownedShare < 20 &&
              " Work confined to the client's own site would leave most of what assistants read untouched."}
          </p>
        </section>

        <section className="flex flex-col gap-3 rounded-lg border p-4">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-base font-medium">Most cited sources</h2>
            <span data-testid="gap-summary" className="metric text-sm text-muted-foreground">
              Client in {data.gap.clientPresentIn} of {data.gap.totalInfluential} · competitors in{" "}
              {data.gap.competitorPresentIn}
            </span>
          </div>

          <div className="overflow-x-auto">
            <table data-testid="sources-table" className="w-full text-sm">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 font-medium">Source</th>
                  <th className="py-2 font-medium">Type</th>
                  <th className="py-2 text-right font-medium">Share</th>
                  <th className="py-2 text-center font-medium">Client</th>
                  <th className="py-2 font-medium">Competitors</th>
                  <th className="py-2 text-right font-medium">Opportunity</th>
                </tr>
              </thead>
              <tbody>
                {data.influential.map((source) => (
                  <tr key={source.domain} className="border-b last:border-0">
                    <td className="py-2">{source.domain}</td>
                    <td className="py-2 text-muted-foreground">
                      {TYPE_LABELS[source.sourceType ?? "unclassified"]}
                    </td>
                    <td className="metric py-2 text-right">{source.sharePct}%</td>
                    <td className="py-2 text-center">
                      {source.clientPresent ? (
                        <span data-testid="client-present" className="text-client-ink">
                          ✓
                        </span>
                      ) : (
                        <span data-testid="client-absent" className="text-muted-foreground">
                          ✗
                        </span>
                      )}
                    </td>
                    <td className="py-2">
                      <span className="flex flex-wrap gap-1">
                        {source.competitorsPresent.map((competitor) => (
                          <span
                            key={competitor}
                            className="rounded-full bg-competitor/15 px-2 py-0.5 text-xs"
                          >
                            {competitor}
                          </span>
                        ))}
                      </span>
                    </td>
                    {/* Оценка берётся из уже посчитанных возможностей, а не
                        считается здесь заново: два определения одной цифры
                        однажды разойдутся, и таблица начнёт спорить со
                        списком возможностей. */}
                    <td className="metric py-2 text-right" data-testid="source-opportunity">
                      {scoreByDomain.get(source.domain) ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <p className="text-sm text-muted-foreground">{data.presenceCaveat}</p>
        </section>
      </div>

      <section className="flex flex-col gap-3 rounded-lg border p-4">
        <h2 className="text-base font-medium">Recommended next actions</h2>

        {/* Сбой и загрузка — не «рекомендовать нечего». */}
        {recommendations.error ? (
          <p role="alert" className="text-sm text-destructive">
            Recommendations could not be loaded. {recommendations.error.message}{" "}
            <button type="button" className="underline" onClick={() => recommendations.refetch()}>
              Try again
            </button>
          </p>
        ) : recommendations.isPending ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (recommendations.data ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nothing to recommend from the current data. More runs will make the picture readable.
          </p>
        ) : (
          <ul data-testid="recommendations-list" className="flex flex-col gap-3">
            {(recommendations.data ?? []).map((recommendation, index) => (
              <li
                key={`${recommendation.rule}-${recommendation.sourceDomain ?? index}`}
                className="flex items-start justify-between gap-4 rounded-md border p-3"
              >
                <div className="flex flex-col gap-1">
                  <span className="flex items-center gap-2 font-medium">
                    {recommendation.title}
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-xs font-normal text-muted-foreground">
                      {recommendation.actionType.replaceAll("_", " ")}
                    </span>
                    <span className="rounded-full border px-2 py-0.5 text-xs font-normal text-muted-foreground">
                      impact: {recommendation.estimatedImpact}
                    </span>
                  </span>
                  {/* Reason — главное здесь: именно его агентство перескажет клиенту. */}
                  <span data-testid="recommendation-reason" className="text-sm text-muted-foreground">
                    {recommendation.reason}
                  </span>
                </div>
                <CreateActionButton clientId={clientId} recommendation={recommendation} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
