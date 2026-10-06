"use client";

import { useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { EXPERIMENT_COPY, formatDay, formatDayShort } from "@repo/core";
import { api } from "@/trpc/react";
import { EmptyState } from "@/components/page-header";
import { ConfidenceBadge, type ConfidenceLevel } from "@/components/ui/stat";
import { NotePanel } from "@/components/ui/note-panel";
import { SkeletonCards } from "@/components/ui/skeleton";
import { buttonClass } from "@/components/ui/button";
import { FlaskConical } from "lucide-react";

/** Строка группы. Прочерк вместо числа — там, где выборка его не набрала. */
function GroupRow({
  label,
  group,
  deltaPp,
  testId,
}: {
  label: string;
  group: {
    beforePct: number | null;
    afterPct: number | null;
    samplesAfter: number;
    sufficient: boolean;
  };
  deltaPp: number | null;
  testId: string;
}) {
  const pct = (value: number | null) => (value === null ? "–" : `${value}%`);

  return (
    <tr data-testid={testId} className="border-b last:border-0">
      <td className="py-2">{label}</td>
      <td className="metric py-2 text-right">{pct(group.beforePct)}</td>
      <td className="metric py-2 text-right">{pct(group.afterPct)}</td>
      <td className="metric py-2 text-right">
        {deltaPp === null ? "–" : `${deltaPp >= 0 ? "+" : ""}${deltaPp} pp`}
      </td>
      <td className="metric py-2 text-right">
        {group.samplesAfter}
        {!group.sufficient && group.samplesAfter > 0 && (
          <span className="ml-1 text-xs text-muted-foreground">(thin)</span>
        )}
      </td>
    </tr>
  );
}

const EVENT_LABELS: Record<string, string> = {
  action_shipped: "Action shipped",
  indexed: "Page indexed",
  first_new_citation: "New cited source appeared",
  visibility_change: "Visibility moved",
  note: "Note",
};

const STATUS_LABELS: Record<string, string> = {
  collecting: "Collecting answers",
  ready: "Ready to read",
};

/** Сбой загрузки — не «пусто»: пустое состояние было бы неправдой о данных. */
function LoadError({
  what,
  error,
  retry,
}: {
  what: string;
  error: { message: string };
  retry: () => void;
}) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-8">
      <h2 className="text-base font-medium">{what} could not be loaded</h2>
      <p className="max-w-prose text-sm text-muted-foreground">{error.message}</p>
      <button type="button" onClick={retry} className={buttonClass("outline", "lg")}>
        Try again
      </button>
    </div>
  );
}

export function ExperimentsView({ clientId }: { clientId: string }) {
  const experiments = api.experiments.list.useQuery({ clientId });
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const rows = experiments.data ?? [];
  const activeId = selectedId ?? rows[0]?.id ?? null;

  if (experiments.isPending) {
    return <SkeletonCards count={3} />;
  }

  if (experiments.error && !experiments.data) {
    return (
      <LoadError what="Experiments" error={experiments.error} retry={() => experiments.refetch()} />
    );
  }

  if (rows.length === 0) {
    return (
      <EmptyState
        title="No experiments yet"
        icon={FlaskConical}
        description="An experiment starts when you complete an action. It records the baseline at that moment, so what follows can be read against it."
      />
    );
  }

  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <ul data-testid="experiments-list" className="flex shrink-0 flex-col gap-2 lg:w-64">
        {rows.map((row) => (
          <li key={row.id}>
            <button
              type="button"
              onClick={() => setSelectedId(row.id)}
              className={`w-full rounded-md border p-3 text-left text-sm ${
                row.id === activeId ? "bg-accent" : "hover:bg-accent/50"
              }`}
            >
              <span className="block font-medium">{row.actionTitle ?? "Action"}</span>
              <span className="metric block text-muted-foreground">
                {formatDay(row.actionDate)} ·{" "}
                {STATUS_LABELS[row.status] ?? row.status}
              </span>
            </button>
          </li>
        ))}
      </ul>

      {activeId && <ExperimentDetail experimentId={activeId} />}
    </div>
  );
}

function ExperimentDetail({ experimentId }: { experimentId: string }) {
  const detail = api.experiments.get.useQuery({ id: experimentId });

  if (detail.isPending) {
    return <SkeletonCards count={3} />;
  }
  if (detail.error && !detail.data) {
    return <LoadError what="This experiment" error={detail.error} retry={() => detail.refetch()} />;
  }
  if (!detail.data) {
    return <p className="text-sm text-muted-foreground">Nothing to show.</p>;
  }

  const {
    experiment,
    events,
    estimate,
    series,
    actionWeek,
    formattedEstimate,
    groups,
    baselineWindow,
  } = detail.data;

  return (
    <div className="flex min-w-0 flex-1 flex-col gap-4">
      <section className="flex flex-col gap-3 rounded-lg border p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 data-testid="estimate-headline" className="metric text-xl font-semibold">
            {formattedEstimate}
          </h2>
          <ConfidenceBadge
            level={estimate.confidence as ConfidenceLevel}
            labelled
            testId="confidence-badge"
            className="px-3 py-1 text-sm"
          />
        </div>

        {/* Обе группы целиком: до, после и на скольких ответах. Движение без
            размера выборки читается как результат, а «+9 pp на двенадцати
            ответах» и «+9 pp на двухстах» — разные утверждения. */}
        <div className="overflow-x-auto">
          <table data-testid="experiment-groups" className="w-full min-w-[520px] text-sm">
            <thead className="text-left text-muted-foreground">
              <tr className="border-b">
                <th className="py-2 font-medium">Group</th>
                <th className="py-2 text-right font-medium">Before</th>
                <th className="py-2 text-right font-medium">After</th>
                <th className="py-2 text-right font-medium">Movement</th>
                <th className="py-2 text-right font-medium">Answers after</th>
              </tr>
            </thead>
            <tbody>
              <GroupRow
                label={`Test group (${groups.treatment.clusters} topics)`}
                group={groups.treatment}
                deltaPp={estimate.treatmentDeltaPp}
                testId="group-treatment"
              />
              <GroupRow
                label={
                  groups.control.clusters === 0
                    ? "Comparison group (none)"
                    : `Comparison group (${groups.control.clusters} topics)`
                }
                group={groups.control}
                deltaPp={estimate.controlDeltaPp}
                testId="group-control"
              />
            </tbody>
          </table>
        </div>

        <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
          <div>
            <dt className="text-muted-foreground">Relative movement</dt>
            <dd data-testid="relative-movement" className="metric">
              {estimate.incrementalPp === null
                ? "–"
                : `${estimate.incrementalPp >= 0 ? "+" : ""}${estimate.incrementalPp} pp`}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Baseline window</dt>
            <dd className="metric">
              {formatDay(baselineWindow.start)} –{" "}
              {formatDay(baselineWindow.end)}
            </dd>
          </div>
          <div>
            <dt className="text-muted-foreground">Action date</dt>
            <dd className="metric">{formatDay(experiment.actionDate)}</dd>
          </div>
        </dl>

        {/* Дисклеймер стоит рядом с цифрой, а не мелким шрифтом внизу страницы. */}
        <p data-testid="estimate-disclaimer" className="max-w-prose text-sm text-muted-foreground">
          {estimate.disclaimer}
        </p>

        <ul data-testid="evidence-list" className="flex flex-col gap-1 text-sm text-muted-foreground">
          {estimate.evidence.map((item) => (
            <li key={item}>· {item}</li>
          ))}
        </ul>

        {/* Отдельным блоком, а не припиской: то, чего цифра не значит, читают
            ровно тогда, когда это выделено так же, как сама цифра. */}
        <NotePanel testId="not-attribution" title="What this does not say" className="p-3">
          {EXPERIMENT_COPY.attributionLimits}
        </NotePanel>
      </section>

      <section className="flex flex-col gap-2 rounded-lg border p-4">
        <h2 className="text-base font-medium">Treated clusters vs comparison group</h2>
        <div data-testid="experiment-chart" className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={series} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
              <XAxis
                  dataKey="week"
                  tickFormatter={(week: string) => formatDayShort(week)}
                  tick={{ fontSize: 12 }}
                  stroke="var(--color-muted-foreground)"
                />
              <YAxis domain={[0, 100]} unit="%" tick={{ fontSize: 12 }} stroke="var(--color-muted-foreground)" />
              <Tooltip
                contentStyle={{
                  background: "var(--color-popover)",
                  border: "1px solid var(--color-border)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              {/* Пунктир на дате действия: без него график не читается. */}
              <ReferenceLine x={actionWeek} stroke="var(--color-muted-foreground)" strokeDasharray="4 4" />
              <Line
                type="monotone"
                dataKey="treatment"
                stroke="var(--color-client)"
                strokeWidth={2}
                connectNulls
                dot={false}
              />
              <Line
                type="monotone"
                dataKey="control"
                stroke="var(--color-competitor)"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                connectNulls
                dot={false}
              />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="flex flex-col gap-3 rounded-lg border p-4">
        <h2 className="text-base font-medium">Timeline</h2>
        <ol data-testid="experiment-timeline" className="flex flex-col gap-3">
          {events.map((event) => (
            <li key={event.id} className="flex gap-3 border-l pl-4 text-sm">
              <span className="metric shrink-0 text-muted-foreground">
                {formatDay(event.occurredAt)}
              </span>
              <span className="flex flex-col">
                <span className="font-medium">{EVENT_LABELS[event.type] ?? event.type}</span>
                {event.note && <span className="text-muted-foreground">{event.note}</span>}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
