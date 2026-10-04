"use client";

import { useState } from "react";
import Link from "next/link";
import { keepPreviousData } from "@tanstack/react-query";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  CONFIDENCE_LABELS,
  MEASUREMENT_COPY,
  measurableAssistants,
  shareOfNamed,
  type Platform,
} from "@repo/core";
import { api, type RouterOutputs } from "@/trpc/react";
import { EmptyState } from "@/components/page-header";
import { buttonClass } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { ScoreDial } from "@/components/ui/score";
import { MatrixSection } from "./matrix-view";
import { TrafficCard } from "./traffic";
import { controlClass } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { SkeletonCards } from "@/components/ui/skeleton";
import { TrendingUp } from "lucide-react";

/** Одна ячейка полосы под вкладками. */
function Meta({
  label,
  children,
  tone,
}: {
  label: string;
  children: React.ReactNode;
  tone?: "client" | "competitor";
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "metric text-sm font-medium",
          tone === "client" && "text-client-ink",
          tone === "competitor" && "text-competitor-ink",
        )}
      >
        {children}
      </dd>
    </div>
  );
}

function when(value: Date | string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

/**
 * Полоса метаданных под вкладками.
 *
 * До неё те же шесть цифр стояли карточками в правой колонке и спорили с
 * матрицей за верх экрана: три прибора одного размера, и ни один не главный.
 * Здесь они читаются одной строкой за секунду, а место героя остаётся у
 * матрицы промптов — единственного, ради чего на этот экран заходят.
 */
function MetadataStrip({
  clientId,
  matrix,
  latest,
}: {
  clientId: string;
  matrix: RouterOutputs["measurement"]["matrix"] | undefined;
  latest: RouterOutputs["measurement"]["visibility"]["latest"];
}) {
  const runs = api.runs.list.useQuery({ clientId });
  const schedule = api.runs.schedule.useQuery({ clientId });

  const lastRun = (runs.data ?? []).find((run) => run.status === "done") ?? null;
  const totals = matrix?.totals;
  const delta = matrix?.totalsDeltaPp ?? null;

  // Полоса примыкает к вкладкам вплотную и уходит под края main: отступ под
  // вкладками гасится, поля страницы — тоже, и цифры читаются как продолжение
  // шапки, а не как ещё одна карточка поверх неё.
  return (
    <div className="-mx-4 -mt-6 flex flex-wrap items-center justify-between gap-x-8 gap-y-3 border-b bg-secondary/40 px-4 py-3 sm:-mx-6 sm:px-6">
      <dl data-testid="client-meta" className="flex min-w-0 flex-wrap gap-x-8 gap-y-3">
        <Meta label="Named in answers">
          <span data-testid="stat-visibility">{latest ? `${latest.visibilityPct}%` : "—"}</span>
        </Meta>

        <Meta
          label={`Change over ${matrix?.windowDays ?? 30} days`}
          tone={
            delta === null ? undefined : delta > 0 ? "client" : delta < 0 ? "competitor" : undefined
          }
        >
          {delta === null ? "—" : `${delta > 0 ? "+" : ""}${delta} pp`}
        </Meta>

        <Meta label="Gap to strongest competitor" tone="competitor">
          <span data-testid="stat-gap">{latest ? `${latest.competitorGapPp} pp` : "—"}</span>
        </Meta>

        <Meta label="Sample">
          {totals ? `${totals.samples} answers · ${totals.confidence}` : "—"}
        </Meta>

        <Meta label="Last run">{when(lastRun?.finishedAt ?? lastRun?.startedAt)}</Meta>

        <Meta label="Next run">
          {/* «not scheduled» — это утверждение о настройке, а не о сбое сети:
              на ошибке загрузки нельзя делать вид, что расписание выключено. */}
          {schedule.error ? "—" : schedule.data?.active ? when(schedule.data.nextRunAt) : "not scheduled"}
        </Meta>
      </dl>

      {/* Обычный Link, а не ButtonLink: типизированные роуты Next проверяют
          href дженериком самого Link, и обёртка теряет тип шаблона. */}
      <Link
        href={`/clients/${clientId}/measure`}
        className={buttonClass("primary", "md", "shrink-0")}
      >
        Measure
      </Link>
    </div>
  );
}

type PlatformFilter = Platform | null;

/** Фильтр по платформе — из каталога: новый ассистент появляется в нём сам. */
const PLATFORMS: { value: PlatformFilter; label: string }[] = [
  { value: null, label: "All platforms" },
  ...measurableAssistants().map((assistant) => ({
    value: assistant.id as Platform,
    label: assistant.label,
  })),
];

const COMPETITOR_COLORS = [
  "var(--color-competitor)",
  "oklch(0.68 0.15 70)",
  "oklch(0.62 0.12 40)",
  "oklch(0.72 0.10 90)",
];

interface WeekDotProps {
  cx?: number;
  cy?: number;
  index?: number;
  payload?: { sufficient?: boolean };
}

/**
 * Точка недели: закрашенная — измерение, полая — неделя ниже порога сэмплов.
 *
 * Такую неделю нельзя ни выбросить, ни нарисовать наравне с остальными:
 * выброшенная превратила бы провал в ровную линию, а равная — выдала бы
 * догадку за измерение.
 */
function renderWeekDot(props: unknown) {
  const { cx, cy, index, payload } = props as WeekDotProps;
  if (cx === undefined || cy === undefined) return <g key={index} />;

  const sufficient = payload?.sufficient !== false;

  return (
    <circle
      key={index}
      cx={cx}
      cy={cy}
      r={3.5}
      fill={sufficient ? "var(--color-client)" : "var(--color-background)"}
      stroke="var(--color-client)"
      strokeWidth={sufficient ? 0 : 1.5}
      strokeDasharray={sufficient ? undefined : "2 2"}
    />
  );
}

/**
 * Что требует человека прямо сейчас.
 *
 * Экран клиента до этого начинался с приборов, и владелец агентства читал
 * графики, чтобы понять, надо ли ему что-то делать. Здесь тот же вывод стоит
 * первым и в одну строку на пункт.
 */
function NeedsAttention({ clientId }: { clientId: string }) {
  const opportunities = api.opportunities.list.useQuery({ clientId });
  const actions = api.actions.list.useQuery({ clientId });
  const experiments = api.experiments.list.useQuery({ clientId });

  if (opportunities.isPending || actions.isPending || experiments.isPending) return null;

  // Сбой хотя бы одного из трёх запросов не должен читаться как «всё чисто»:
  // это тот же ложный «пусто», что уже правили в ленте решений и в отчётах.
  if (opportunities.error || actions.error || experiments.error) {
    return (
      <Card data-testid="needs-attention" className="flex flex-col gap-2">
        <CardTitle>What needs a person</CardTitle>
        <p className="text-sm text-muted-foreground">This could not be checked right now.</p>
      </Card>
    );
  }

  const open = (opportunities.data ?? []).filter((row) => row.status === "open");
  const highPriority = open.filter((row) => row.priority === "high");
  const stalled = (actions.data ?? []).filter(
    (action) =>
      (action.status === "backlog" || action.status === "in_progress") &&
      Date.now() - new Date(action.createdAt).getTime() > 14 * 86_400_000,
  );
  const readyExperiments = (experiments.data ?? []).filter(
    (experiment) => experiment.status === "ready",
  );

  const nothingWaiting =
    highPriority.length === 0 && stalled.length === 0 && readyExperiments.length === 0;

  return (
    <Card data-testid="needs-attention" className="flex flex-col gap-2">
      <CardTitle>What needs a person</CardTitle>
      {nothingWaiting ? (
        <p className="text-sm text-muted-foreground">Nothing is waiting on a person right now.</p>
      ) : (
        <ul className="flex flex-col gap-1.5 text-sm">
          {highPriority.length > 0 && (
            <li>
              <Link
                href={`/clients/${clientId}/opportunities`}
                className="text-primary hover:underline"
              >
                {highPriority.length} high-priority{" "}
                {highPriority.length === 1 ? "opportunity" : "opportunities"} →
              </Link>
            </li>
          )}
          {stalled.length > 0 && (
            <li>
              <Link href={`/clients/${clientId}/actions`} className="text-primary hover:underline">
                {stalled.length} {stalled.length === 1 ? "action has" : "actions have"} been open
                over two weeks →
              </Link>
            </li>
          )}
          {readyExperiments.length > 0 && (
            <li>
              <Link
                href={`/clients/${clientId}/experiments`}
                className="text-primary hover:underline"
              >
                {readyExperiments.length}{" "}
                {readyExperiments.length === 1 ? "experiment is" : "experiments are"} ready to
                review →
              </Link>
            </li>
          )}
        </ul>
      )}
    </Card>
  );
}

/**
 * Следующая работа.
 *
 * В этом продукте возможности и есть ранжированная очередь: у каждой строки
 * есть счёт, и он объясняет порядок. Три карточки во всю ширину занимали
 * столько же места, сколько сама матрица, — здесь пять строк в половине
 * ширины, и решение принимается по счёту, а не по объёму карточки.
 */
function NextWork({ clientId }: { clientId: string }) {
  const opportunities = api.opportunities.list.useQuery({ clientId });
  const top = (opportunities.data ?? []).filter((row) => row.status === "open").slice(0, 5);

  return (
    <Card data-testid="top-opportunities" className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <CardTitle>Next work</CardTitle>
        <Link
          href={`/clients/${clientId}/opportunities`}
          className="text-sm text-primary hover:underline"
        >
          All opportunities →
        </Link>
      </div>

      {top.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {opportunities.isPending
            ? "Loading…"
            : opportunities.error
              ? "Opportunities could not be loaded."
              : "No open opportunities. New ones appear after the next run."}
        </p>
      ) : (
        <ul className="flex flex-col gap-2.5">
          {top.map((row) => (
            <li key={row.id} className="flex items-start gap-3">
              <ScoreDial score={row.score} className="shrink-0" />
              <Link
                href={`/clients/${clientId}/opportunities`}
                className="min-w-0 flex-1 text-sm underline-offset-4 hover:underline"
              >
                <span className="font-medium">{row.title}</span>
                <span className="line-clamp-2 text-xs text-muted-foreground">{row.reason}</span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

/**
 * Откуда берутся ответы — верхушка диагноза источников.
 *
 * Полный разбор живёт на своём экране; здесь ровно столько, чтобы понять,
 * стоит ли туда идти.
 */
function SourceMixCard({ clientId }: { clientId: string }) {
  const sources = api.diagnosis.sourceGraph.useQuery({ clientId });
  const mix = (sources.data?.mix ?? []).slice(0, 5);

  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <CardTitle>Where the answers come from</CardTitle>
        <Link href={`/clients/${clientId}/diagnose`} className="text-sm text-primary hover:underline">
          Diagnose →
        </Link>
      </div>

      {mix.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          {sources.isPending
            ? "Loading…"
            : sources.error
              ? "Sources could not be loaded."
              : MEASUREMENT_COPY.noDataYet}
        </p>
      ) : (
        <ul className="flex flex-col gap-2 text-sm">
          {mix.map((entry) => (
            <li key={entry.sourceType} className="flex items-center gap-3">
              <span className="w-28 shrink-0 truncate text-muted-foreground">
                {entry.sourceType.replace(/_/g, " ")}
              </span>
              <span aria-hidden className="h-1.5 min-w-0 flex-1 rounded-full bg-muted">
                <span
                  className="block h-full rounded-full bg-primary"
                  style={{ width: `${Math.min(100, entry.sharePct)}%` }}
                />
              </span>
              <span className="metric w-12 shrink-0 text-right">
                {Math.round(entry.sharePct)}%
              </span>
            </li>
          ))}
        </ul>
      )}

      {sources.data && (
        <p className="text-xs text-muted-foreground">{sources.data.presenceCaveat}</p>
      )}
    </Card>
  );
}

/** Одна фраза, которую агентство перескажет своему клиенту. */
function OneLineRead({ matrix }: { matrix: RouterOutputs["measurement"]["matrix"] }) {
  const { totals, rows } = matrix;
  const competitor = totals.competitorTop;

  return (
    <Card className="flex flex-col gap-2">
      <CardTitle>Read as one line</CardTitle>

      <p data-testid="one-line-read" className="text-sm text-muted-foreground">
        {totals.ratePct === null ? (
          MEASUREMENT_COPY.noDataYet
        ) : (
          <>
            {matrix.client.name} is named in an estimated{" "}
            <span className="metric font-medium text-foreground">{Math.round(totals.ratePct)}%</span>{" "}
            of answers to the {rows.length} tracked {rows.length === 1 ? "prompt" : "prompts"}
            {totals.interval && (
              <>
                {" "}
                (<span className="metric">
                  {Math.round(totals.interval.low)}–{Math.round(totals.interval.high)}%
                </span>{" "}
                on this sample)
              </>
            )}
            {matrix.totalsDeltaPp !== null && (
              <>
                , {matrix.totalsDeltaPp === 0 ? "flat" : matrix.totalsDeltaPp > 0 ? "up" : "down"}{" "}
                <span className="metric">{Math.abs(matrix.totalsDeltaPp)} pp</span> against the
                previous {matrix.windowDays} days
                {/*
                  Доля выше посчитана по всему, что измерено сейчас, а
                  изменение — по общей части двух окон. Это намеренно разные
                  основания, и фраза называет своё, вместо того чтобы
                  притворяться, будто относится к числу выше.
                */}
                {matrix.assistantBasis.verdict !== "same" && (
                  <span data-testid="delta-basis">
                    {" "}
                    on {matrix.assistantBasis.shared.length} shared{" "}
                    {matrix.assistantBasis.shared.length === 1 ? "assistant" : "assistants"}
                  </span>
                )}
                {/* Пересекающиеся интервалы — это «не различить», а не «выросло». */}
                {!matrix.totalsDistinguishable && (
                  <span data-testid="within-noise"> — {MEASUREMENT_COPY.withinNoise}</span>
                )}
              </>
            )}
            .
            {/*
              Состав менялся — об этом говорится там же, где число, а не в
              сноске: молчаливый пересчёт был бы вторым способом соврать.
            */}
            {matrix.assistantBasisNote && (
              <span data-testid="assistant-basis"> {matrix.assistantBasisNote}</span>
            )}
            {competitor && (
              <>
                {" "}
                {competitor.name} is named in {Math.round(competitor.pct)}% of the same answers.
              </>
            )}
          </>
        )}
      </p>

      <div className="flex flex-wrap gap-1.5">
        <span className="rounded-full bg-client/15 px-2 py-1 text-[11px] font-medium">
          {CONFIDENCE_LABELS[totals.confidence].toLowerCase()}
        </span>
        <span className="metric rounded-full bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground">
          {totals.samples} answers sampled
        </span>
        <span className="rounded-full bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground">
          estimated
        </span>
      </div>
    </Card>
  );
}

/**
 * Как именно назван клиент, а не только назван ли.
 *
 * Ответ, где клиент стоит четвёртым в списке «а ещё бывают», и ответ, где он
 * назван первым, дают одну и ту же долю упоминаний, но продают по-разному.
 * Порядок брендов парсер сохраняет с самого начала — считать заново нечего.
 */
function ProminenceCard({ matrix }: { matrix: RouterOutputs["measurement"]["matrix"] }) {
  const { prominence } = matrix;

  const first = shareOfNamed(prominence.namedFirst, prominence.named);
  const behind = shareOfNamed(prominence.behindCompetitors, prominence.named);

  return (
    <Card className="flex flex-col gap-2">
      <CardTitle>How you are named</CardTitle>

      {prominence.named === 0 || !prominence.sufficient ? (
        <p data-testid="prominence-empty" className="text-sm text-muted-foreground">
          {prominence.answers === 0
            ? MEASUREMENT_COPY.noDataYet
            : prominence.named === 0
              ? "Not named in any sampled answer in this window."
              : MEASUREMENT_COPY.underFloor}
        </p>
      ) : (
        <>
          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div className="flex flex-col gap-0.5">
              <dt className="text-muted-foreground">Named first</dt>
              <dd data-testid="prominence-first" className="metric text-lg font-semibold">
                {first === null ? "—" : `${Math.round(first)}%`}
              </dd>
            </div>
            <div className="flex flex-col gap-0.5">
              <dt className="text-muted-foreground">After a competitor</dt>
              <dd data-testid="prominence-behind" className="metric text-lg font-semibold">
                {behind === null ? "—" : `${Math.round(behind)}%`}
              </dd>
            </div>
          </dl>

          <p className="text-sm text-muted-foreground">
            Of the <span className="metric">{prominence.named}</span> answers naming{" "}
            {matrix.client.name}, this is where the brand sits among the others. Typical place:{" "}
            <span className="metric">{prominence.averageRank}</span> of the brands named.
          </p>
        </>
      )}
    </Card>
  );
}

export function ClientOverview({ clientId }: { clientId: string }) {
  const [platform, setPlatform] = useState<PlatformFilter>(null);
  const [clusterId, setClusterId] = useState<string | null>(null);

  const clusters = api.prompts.clusters.useQuery({ clientId });
  // Смена фильтра держит прежние цифры, пока грузятся новые: иначе вся
  // страница схлопывается в скелетоны и теряет место прокрутки.
  const data = api.measurement.visibility.useQuery(
    { clientId, platform, clusterId },
    { placeholderData: keepPreviousData },
  );
  const matrix = api.measurement.matrix.useQuery({ clientId });

  if (data.isPending) {
    return <SkeletonCards count={3} />;
  }

  const latest = data.data?.latest ?? null;
  const series = data.data?.series ?? [];
  const competitors = (data.data?.competitorNames ?? []).slice(0, 4);
  const thinWeeks = series.filter((point) => !point.sufficient).length;

  const chartData = series.map((point) => {
    const row: Record<string, string | number | boolean> = {
      week: new Date(point.periodStart).toISOString().slice(0, 10),
      client: point.clientVisibilityPct,
      sufficient: point.sufficient,
    };
    for (const competitor of competitors) {
      row[competitor] = point.competitorVisibility[competitor] ?? 0;
    }
    return row;
  });

  return (
    <div className="flex flex-col gap-6">
      {/* Цифры первыми и одной строкой: полоса отвечает «как дела», а место
          героя остаётся у матрицы — «где именно». */}
      <MetadataStrip clientId={clientId} matrix={matrix.data} latest={latest} />

      {/* Что именно человек видит на этом экране — до того, как он прочтёт первую цифру. */}
      <p
        data-testid="method-note"
        className="flex items-start gap-2.5 rounded-lg border border-dashed p-3 text-sm text-muted-foreground"
      >
        <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-primary" />
        {MEASUREMENT_COPY.methodNote}
      </p>

      {/*
        Герой — матрица промптов: единственное место, где видно, какой именно
        вопрос проигран и какому ассистенту. Справа — что решать и две вещи,
        которых в матрице нет.

        Карточки источников и работы стоят в левой колонке, а не отдельной
        секцией ниже: правая колонка вдвое выше матрицы, и вынесенные вниз они
        оставляли под матрицей пустую половину экрана.
      */}
      <div className="grid items-start gap-4 lg:grid-cols-[1fr_300px]">
        {matrix.data ? (
          <MatrixSection matrix={matrix.data} />
        ) : (
          <Card className="text-sm text-muted-foreground">
            {matrix.isPending ? "Loading…" : MEASUREMENT_COPY.noDataYet}
          </Card>
        )}

        <div className="flex min-w-0 flex-col gap-3">
          <NeedsAttention clientId={clientId} />
          {matrix.data && <OneLineRead matrix={matrix.data} />}
          {matrix.data && <ProminenceCard matrix={matrix.data} />}
        </div>
      </div>

      {/* Три равных карточки во всю ширину: откуда берутся ответы, за что
          браться и сколько людей действительно пришло. */}
      <div className="grid items-start gap-4 lg:grid-cols-3">
        <SourceMixCard clientId={clientId} />
        <NextWork clientId={clientId} />
        <TrafficCard clientId={clientId} visibilityDeltaPp={matrix.data?.totalsDeltaPp ?? null} />
      </div>

      {latest && !latest.sufficient && (
        <p
          data-testid="insufficient-warning"
          className="rounded-md border border-dashed p-3 text-sm text-muted-foreground"
        >
          Fewer than {latest.minSamples} answers in this window. Treat the number as indicative
          until more runs land — a single answer is not a measurement.
        </p>
      )}

      <section className="flex flex-col gap-3 rounded-lg border p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-base font-medium">Visibility over time</h2>
          <div className="flex gap-2">
            <select
              aria-label="Platform"
              value={platform ?? ""}
              onChange={(e) => setPlatform((e.target.value || null) as PlatformFilter)}
              className={cn(controlClass, "h-10 px-2.5")}
            >
              {PLATFORMS.map((option) => (
                <option key={option.label} value={option.value ?? ""}>
                  {option.label}
                </option>
              ))}
            </select>
            <select
              aria-label="Cluster"
              value={clusterId ?? ""}
              onChange={(e) => setClusterId(e.target.value || null)}
              className={cn(controlClass, "h-10 px-2.5")}
            >
              <option value="">All clusters</option>
              {(clusters.data ?? []).map((cluster) => (
                <option key={cluster.id} value={cluster.id}>
                  {cluster.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        {chartData.length === 0 ? (
          <EmptyState
            title="No visibility data yet"
        icon={TrendingUp}
            description="Run a check from the Measure screen. Visibility is read from the share of answers across a week, so the first useful reading appears once a run completes."
          />
        ) : (
          <div data-testid="visibility-chart" className="h-72 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--color-border)" />
                <XAxis dataKey="week" tick={{ fontSize: 12 }} stroke="var(--color-muted-foreground)" />
                <YAxis
                  domain={[0, 100]}
                  unit="%"
                  tick={{ fontSize: 12 }}
                  stroke="var(--color-muted-foreground)"
                />
                <Tooltip
                  contentStyle={{
                    background: "var(--color-popover)",
                    border: "1px solid var(--color-border)",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                {/* Клиент — зелёным, конкуренты — оранжевыми оттенками (§4.3 плана). */}
                <Line
                  type="monotone"
                  dataKey="client"
                  stroke="var(--color-client)"
                  strokeWidth={2}
                  dot={renderWeekDot}
                />
                {competitors.map((competitor, index) => (
                  <Line
                    key={competitor}
                    type="monotone"
                    dataKey={competitor}
                    stroke={COMPETITOR_COLORS[index % COMPETITOR_COLORS.length]}
                    strokeWidth={1.5}
                    strokeDasharray="4 3"
                    dot={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}

        <p className="text-sm text-muted-foreground">
          {MEASUREMENT_COPY.visibilityBasis}
          {thinWeeks > 0 && (
            <>
              {" "}
              <span data-testid="thin-weeks">
                {thinWeeks} {thinWeeks === 1 ? "week is" : "weeks are"} drawn hollow:{" "}
                {MEASUREMENT_COPY.underFloor}
              </span>
            </>
          )}
        </p>
      </section>

      <ActivityFeed clientId={clientId} />
    </div>
  );
}

const EVENT_LABELS: Record<string, string> = {
  action_created: "Action created",
  action_status_changed: "Action moved",
  action_completed: "Action completed",
  run_finished: "Check finished",
  report_generated: "Report generated",
  report_approved: "Report approved",
};

/** Лента событий — то, из чего собирается раздел «что сделано» в отчёте клиенту. */
function ActivityFeed({ clientId }: { clientId: string }) {
  const activity = api.actions.activity.useQuery({ clientId, limit: 10 });
  const entries = activity.data ?? [];

  return (
    <section className="flex flex-col gap-3 rounded-lg border p-4">
      <h2 className="text-base font-medium">Recent activity</h2>

      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Nothing has happened for this client yet. Runs and actions show up here as they land.
        </p>
      ) : (
        <ul data-testid="activity-feed" className="flex flex-col gap-2 text-sm">
          {entries.map((entry) => (
            <li key={entry.id} className="flex items-baseline gap-3">
              <span className="metric shrink-0 text-muted-foreground">
                {new Date(entry.createdAt).toLocaleString()}
              </span>
              <span className="font-medium">{EVENT_LABELS[entry.eventType] ?? entry.eventType}</span>
              <span className="truncate text-muted-foreground">
                {typeof entry.payload["title"] === "string"
                  ? entry.payload["title"]
                  : typeof entry.payload["status"] === "string"
                    ? `${String(entry.payload["answers"] ?? "")} answers · ${entry.payload["status"]}`
                    : ""}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
