"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { MEASUREMENT_COPY } from "@repo/core";
import { api, type RouterOutputs } from "@/trpc/react";
import { buttonClass } from "@/components/ui/button";
import { Card, CardTitle } from "@/components/ui/card";
import { NotePanel } from "@/components/ui/note-panel";
import { SkeletonCards } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Лента решений.
 *
 * Главный экран открывался счётчиками и таблицей: его можно было прочитать
 * целиком и всё равно не понять, кому сегодня звонить. Здесь каждая строка
 * называет ровно одно дело, ждущее человека, и несёт кнопку, которая его
 * закрывает. Цифры рядом стоят затем, чтобы строку оправдать, а не затем,
 * чтобы их разглядывали.
 *
 * Ничего из ленты не уходит наружу само — все кнопки ведут на экран решения.
 */

type Row = RouterOutputs["clients"]["portfolio"][number];
type Need = Row["needsRows"][number];

const GROUPING_KEY = "dashboard-grouping";

/** Полоска слева — срочность, а не украшение. */
const TONE_RAIL: Record<Need["tone"], string> = {
  "needs-you": "bg-primary",
  overdue: "bg-competitor",
  info: "bg-border",
};

/** Заголовок группы, когда лента сложена по виду работы. */
const KIND_LABELS: Record<Need["kind"], string> = {
  opportunity: "Opportunities to review",
  report: "Reports waiting on approval",
  action: "Work that has stalled",
  run: "Measurement",
};

const KIND_ORDER = ["opportunity", "report", "action", "run"] as const;

/**
 * Адрес собирается здесь, а не в `needsFor`: типизированные роуты Next
 * проверяют литерал ссылки, поэтому склейка обязана происходить в месте, где
 * известны все возможные шаблоны.
 */
function hrefFor(clientId: string, need: Need) {
  switch (need.to) {
    case "opportunities":
      return `/clients/${clientId}/opportunities` as const;
    case "reports":
      return `/clients/${clientId}/reports` as const;
    case "actions":
      return `/clients/${clientId}/actions` as const;
    case "measure":
      return `/clients/${clientId}/measure` as const;
  }
}

/** Строка «31% named · +7 pp · confidence medium» под именем клиента. */
function summaryOf(row: Row): string {
  const named =
    row.visibilityPct === null ? "not measured yet" : `${Math.round(row.visibilityPct)}% named`;
  const delta = row.deltaPp === null ? null : `${row.deltaPp > 0 ? "+" : ""}${row.deltaPp} pp`;
  return [named, delta, `confidence ${row.confidence}`].filter(Boolean).join(" · ");
}

function FeedRow({ clientId, need }: { clientId: string; need: Need }) {
  return (
    <Card padding="none" className="flex items-center gap-3 p-3">
      <span aria-hidden className={cn("w-0.5 self-stretch rounded-full", TONE_RAIL[need.tone])} />
      <span className="min-w-0 flex-1 text-sm">{need.text}</span>
      <Link
        href={hrefFor(clientId, need)}
        className={buttonClass(need.tone === "info" ? "outline" : "primary", "sm", "shrink-0")}
      >
        {need.cta}
      </Link>
    </Card>
  );
}

export function DecisionFeed() {
  const portfolio = api.clients.portfolio.useQuery();
  const [byWork, setByWork] = useState(false);

  // Выбор переживает перезагрузку: это привычка работы, а не настройка на один
  // заход. Читается после монтирования — сервер про localStorage не знает.
  useEffect(() => {
    try {
      setByWork(window.localStorage.getItem(GROUPING_KEY) === "work");
    } catch {
      // Приватный режим: просто не запомним.
    }
  }, []);

  function choose(next: boolean) {
    setByWork(next);
    try {
      window.localStorage.setItem(GROUPING_KEY, next ? "work" : "client");
    } catch {
      // См. выше.
    }
  }

  if (portfolio.isPending) return <SkeletonCards count={3} />;

  /**
   * Сбой не должен выглядеть как «все дела закрыты» — это тот же соблазн, что
   * уже ловили в таблице портфеля: пустой список из ошибки читается как самая
   * спокойная новость, а на деле человек просто не увидел, что его ждёт.
   * Упавшее фоновое обновление уже загруженную ленту не стирает.
   */
  if (portfolio.error && !portfolio.data) {
    return (
      <Card dashed className="text-sm text-muted-foreground">
        The feed could not be loaded. {portfolio.error.message}
      </Card>
    );
  }

  const rows = portfolio.data ?? [];
  const waiting = rows.filter((row) => row.needsRows.length > 0);

  const groups = byWork
    ? KIND_ORDER.map((kind) => ({
        key: kind as string,
        head: KIND_LABELS[kind],
        sub: null as string | null,
        items: waiting.flatMap((row) =>
          row.needsRows
            .filter((need) => need.kind === kind)
            .map((need) => ({ clientId: row.clientId, need, label: row.name })),
        ),
      })).filter((group) => group.items.length > 0)
    : waiting.map((row) => ({
        key: row.clientId,
        head: row.name,
        sub: summaryOf(row),
        items: row.needsRows.map((need) => ({
          clientId: row.clientId,
          need,
          label: null as string | null,
        })),
      }));

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground">
          {waiting.length === 0
            ? "Nothing is waiting on a person."
            : `${waiting.length} of ${rows.length} ${
                rows.length === 1 ? "client needs" : "clients need"
              } a decision.`}
        </p>
        <div
          role="group"
          aria-label="Group the feed"
          className="flex shrink-0 gap-0.5 rounded-md bg-muted p-0.5"
        >
          {(
            [
              ["By client", false],
              ["By work", true],
            ] as const
          ).map(([label, value]) => (
            <button
              key={label}
              type="button"
              onClick={() => choose(value)}
              aria-pressed={byWork === value}
              className={cn(
                "rounded-md px-2.5 py-1 text-xs transition-colors",
                byWork === value
                  ? "bg-card font-medium text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {groups.length === 0 ? (
        <Card className="text-sm text-muted-foreground">
          Every client is up to date. New opportunities appear here after the next run.
        </Card>
      ) : (
        <div data-testid="decision-feed" className="flex flex-col gap-4">
          {groups.map((group) => (
            <section key={group.key} className="flex flex-col gap-1.5">
              <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
                <h2 className="text-[13px] font-semibold">{group.head}</h2>
                {group.sub && <span className="metric text-xs text-muted-foreground">{group.sub}</span>}
              </div>
              {group.items.map((item, index) => (
                <div key={`${item.clientId}-${index}`} className="flex flex-col gap-1">
                  {item.label && (
                    <span className="pl-0.5 text-xs text-muted-foreground">{item.label}</span>
                  )}
                  <FeedRow clientId={item.clientId} need={item.need} />
                </div>
              ))}
            </section>
          ))}
        </div>
      )}

      <NotePanel title="Nothing leaves the product on its own">
        Reports reach a client only after a person approves them, and no row here changes a
        client&rsquo;s site. {MEASUREMENT_COPY.visibilityBasis}
      </NotePanel>
    </div>
  );
}

/** Правая колонка: расход месяца и состояние прогонов. */
export function DashboardRail() {
  const usage = api.billing.usage.useQuery();
  const runs = api.clients.runStats.useQuery();
  const portfolio = api.clients.portfolio.useQuery();

  const underFloor = (portfolio.data ?? []).filter((row) => !row.sufficient).length;
  const checks = usage.data?.aiChecks;
  const ratio = checks ? Math.min(100, Math.round(checks.ratio * 100)) : 0;
  const failed = runs.data?.failedLastWeek ?? 0;

  return (
    <div className="flex flex-col gap-3">
      <Card className="flex flex-col gap-3">
        {/* Бесплатные проверки считаются за всё время, а не за месяц:
            «This month» обещало бы, что они вернутся первого числа. */}
        <CardTitle>{checks?.free ? "Free audit" : "This month"}</CardTitle>
        {usage.data && checks ? (
          <div className="flex flex-col gap-2 text-sm">
            <span className="flex items-baseline justify-between gap-3 text-muted-foreground">
              Clients measured
              <span className="metric font-medium text-foreground">
                {usage.data.clients.used} / {usage.data.clients.limit}
              </span>
            </span>
            <span className="flex items-baseline justify-between gap-3 text-muted-foreground">
              {checks.free ? "Free AI checks used" : "AI checks used"}
              <span className="metric font-medium text-foreground">
                {checks.used.toLocaleString("en-US")} / {checks.allowance.toLocaleString("en-US")}
              </span>
            </span>
            <span aria-hidden className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <span
                className={cn("block h-full rounded-full", checks.overAllowance ? "bg-competitor" : "bg-primary")}
                style={{ width: `${ratio}%` }}
              />
            </span>
            <span className="text-xs text-muted-foreground">
              One check is one answer from one assistant to one prompt.
            </span>
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            {usage.error ? "Usage could not be loaded." : "Usage appears after the first run."}
          </p>
        )}
      </Card>

      <Card className="flex flex-col gap-3">
        <CardTitle>Runs</CardTitle>
        <div className="flex flex-col gap-2 text-sm">
          <span className="flex items-baseline justify-between gap-3 text-muted-foreground">
            Scheduled today
            <span className="metric font-medium text-foreground">
              {runs.data?.scheduledToday ?? "—"}
            </span>
          </span>
          <span className="flex items-baseline justify-between gap-3 text-muted-foreground">
            Failed in 7 days
            <span
              className={cn("metric font-medium", failed > 0 ? "text-competitor-ink" : "text-foreground")}
            >
              {runs.data?.failedLastWeek ?? "—"}
            </span>
          </span>
          <span className="flex items-baseline justify-between gap-3 text-muted-foreground">
            Under the sample floor
            <span className="metric font-medium text-foreground">
              {portfolio.data ? underFloor : "—"}
            </span>
          </span>
          {underFloor > 0 && (
            <span className="text-xs text-muted-foreground">{MEASUREMENT_COPY.underFloor}</span>
          )}
        </div>
      </Card>
    </div>
  );
}
