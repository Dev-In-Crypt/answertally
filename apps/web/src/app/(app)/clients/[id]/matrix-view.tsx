"use client";

import { useState } from "react";
import { CONFIDENCE_LABELS, MEASUREMENT_COPY } from "@repo/core";
import type { RouterOutputs } from "@/trpc/react";
import { cn } from "@/lib/utils";

/**
 * Матрица «промпт × ассистент» и два других её прочтения.
 *
 * Одна общая цифра видимости прячет главное: клиент может быть назван в
 * трети ответов и при этом отсутствовать в двух вопросах, по которым его
 * выбирают. Поэтому герой экрана — сетка, а сводки по платформе и по
 * промпту стоят рядом как альтернативные взгляды на те же ответы.
 */

type Matrix = RouterOutputs["measurement"]["matrix"];
type Row = Matrix["rows"][number];
type Cell = Row["cells"][number];
type AssistantSummary = Matrix["assistants"][number];

type View = "grid" | "bars" | "cards";

const VIEWS: { id: View; label: string }[] = [
  { id: "grid", label: "Grid" },
  { id: "bars", label: "By prompt" },
  { id: "cards", label: "By assistant" },
];

/** Заливка ячейки: чем чаще названы, тем плотнее зелёный. */
function cellFill(ratePct: number): string {
  const alpha = 10 + (ratePct / 100) * 78;
  return `color-mix(in oklch, var(--color-client) ${alpha.toFixed(0)}%, transparent)`;
}

function formatPct(value: number | null): string {
  return value === null ? "–" : `${Math.round(value)}%`;
}

function cellTitle(cell: Cell, assistant: AssistantSummary, minSamples: number): string {
  if (!cell.measurable) {
    return `${assistant.label}: ${MEASUREMENT_COPY.notMeasured}`;
  }
  if (!cell.sufficient) {
    return `${assistant.label}: ${cell.samples} of ${minSamples} answers needed. ${MEASUREMENT_COPY.underFloor}`;
  }

  const named = Math.round((cell.ratePct! / 100) * cell.samples);
  const competitor = cell.competitorOnly ? ` · ${MEASUREMENT_COPY.competitorOnly}` : "";
  return `${assistant.label}: named in ${named} of ${cell.samples} answers${competitor}`;
}

function MatrixGrid({ matrix }: { matrix: Matrix }) {
  const columns = `minmax(0, 1.6fr) repeat(${matrix.assistants.length}, minmax(0, 1fr))`;

  return (
    <div className="overflow-x-auto">
      <div data-testid="matrix-grid" className="grid min-w-[560px] items-center gap-1" style={{ gridTemplateColumns: columns }}>
        <span />
        {matrix.assistants.map((assistant) => (
          <span
            key={assistant.id}
            title={assistant.measurable ? assistant.label : MEASUREMENT_COPY.notMeasured}
            className={cn(
              "text-center text-[11px] font-medium",
              assistant.measurable ? "text-muted-foreground" : "text-muted-foreground/50",
            )}
          >
            {assistant.short}
            {!assistant.measurable && <span aria-hidden> ·</span>}
          </span>
        ))}

        {matrix.rows.map((row) => (
          <MatrixRow key={row.promptId} row={row} matrix={matrix} />
        ))}
      </div>
    </div>
  );
}

function MatrixRow({ row, matrix }: { row: Row; matrix: Matrix }) {
  return (
    <>
      <span title={row.promptText} className="truncate pr-2 text-xs">
        {row.promptText}
      </span>

      {row.cells.map((cell, index) => {
        const assistant = matrix.assistants[index]!;
        const title = cellTitle(cell, assistant, matrix.minSamples);

        if (!cell.measurable) {
          return (
            <div
              key={cell.assistantId}
              title={title}
              data-testid="matrix-cell-unmeasured"
              className="metric flex h-8 items-center justify-center rounded-md border border-dashed text-[11px] text-muted-foreground/50"
              style={{
                // Штриховка, а не пустой фон: клетка должна выглядеть иначе,
                // чем измеренный ноль, и не читаться как «искали, не нашли».
                backgroundImage:
                  "repeating-linear-gradient(45deg, var(--color-muted) 0 3px, transparent 3px 6px)",
              }}
            >
              –
            </div>
          );
        }

        return (
          <div
            key={cell.assistantId}
            title={title}
            data-testid="matrix-cell"
            className={cn(
              "metric relative flex h-8 items-center justify-center rounded-md border border-transparent text-[11px] font-medium",
              !cell.sufficient && "border-dashed border-border text-muted-foreground",
              cell.sufficient && cell.ratePct! > 55 && "text-white",
            )}
            style={
              cell.sufficient && cell.ratePct !== null
                ? { backgroundColor: cellFill(cell.ratePct) }
                : undefined
            }
          >
            {formatPct(cell.ratePct)}
            {cell.competitorOnly && (
              <span
                aria-hidden
                data-testid="competitor-dot"
                className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-competitor"
              />
            )}
          </div>
        );
      })}
    </>
  );
}

function PresenceBars({ matrix }: { matrix: Matrix }) {
  const movement = new Map(matrix.movement.map((entry) => [entry.promptId, entry.deltaPp]));

  return (
    <div data-testid="matrix-bars" className="flex flex-col gap-4">
      {matrix.rows.map((row) => {
        const delta = movement.get(row.promptId) ?? null;

        return (
        <div key={row.promptId} className="flex flex-col gap-1.5">
          <div className="flex items-baseline justify-between gap-3">
            <span className="text-xs">{row.promptText}</span>
            <span className="metric shrink-0 text-xs text-muted-foreground">
              {/* Что изменилось — вопрос, который клиент задаёт первым. */}
              {delta !== null && (
                <span
                  data-testid="row-delta"
                  className={cn(
                    "mr-2 font-medium",
                    delta > 0 && "text-client-ink",
                    delta < 0 && "text-competitor-ink",
                  )}
                >
                  {delta > 0 ? "+" : ""}
                  {delta} pp
                </span>
              )}
              {formatPct(row.ratePct)}
              {row.competitorTop && ` vs ${formatPct(row.competitorTop.pct)}`}
            </span>
          </div>

          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-client"
              style={{ width: `${row.ratePct ?? 0}%` }}
            />
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-muted">
            <div
              className="h-full rounded-full bg-competitor"
              style={{ width: `${row.competitorTop?.pct ?? 0}%` }}
            />
          </div>

          <span className="text-[11px] text-muted-foreground">
            {row.sufficient
              ? row.competitorTop
                ? `${row.competitorTop.name} leads by ${Math.round((row.competitorTop.pct ?? 0) - (row.ratePct ?? 0))} pp · ${row.samples} answers sampled · estimated`
                : `No tracked competitor named here · ${row.samples} answers sampled · estimated`
              : `${row.samples} answers so far. ${MEASUREMENT_COPY.underFloor}`}
          </span>
        </div>
        );
      })}
    </div>
  );
}

function AssistantCards({ matrix }: { matrix: Matrix }) {
  return (
    <div data-testid="matrix-cards" className="grid gap-2 sm:grid-cols-2">
      {matrix.assistants.map((assistant) => (
        <div
          key={assistant.id}
          className={cn(
            "flex flex-col gap-2 rounded-lg border p-3",
            !assistant.measurable && "border-dashed",
          )}
        >
          <div className="flex items-baseline justify-between gap-2">
            <span className={cn("text-sm font-medium", !assistant.measurable && "text-muted-foreground")}>
              {assistant.label}
            </span>
            <span className="metric text-lg font-semibold">{formatPct(assistant.ratePct)}</span>
          </div>

          <div className="h-1.5 overflow-hidden rounded-full bg-muted">
            <div
              className={cn("h-full rounded-full", assistant.sufficient ? "bg-client" : "bg-border")}
              style={{ width: `${assistant.ratePct ?? 0}%` }}
            />
          </div>

          <span className="text-[11px] text-muted-foreground">
            {assistant.measurable
              ? `${assistant.samples} answers · ${CONFIDENCE_LABELS[assistant.confidence].toLowerCase()}`
              : MEASUREMENT_COPY.notMeasured}
          </span>
        </div>
      ))}
    </div>
  );
}

export function MatrixSection({ matrix }: { matrix: Matrix }) {
  const [view, setView] = useState<View>("grid");

  const unmeasured = matrix.assistants.filter((assistant) => !assistant.measurable);
  /**
   * Неспрашиваемые ассистенты — одной строкой под таблицей, а не пустыми
   * столбцами: три серых столбца с непонятными сокращениями занимали место и
   * читались как недоработка.
   */
  const keep = matrix.assistants.map((assistant) => assistant.measurable);
  const shown: Matrix = {
    ...matrix,
    assistants: matrix.assistants.filter((_, index) => keep[index]),
    rows: matrix.rows.map((row) => ({ ...row, cells: row.cells.filter((_, index) => keep[index]) })),
  };

  return (
    // min-w-0 обязателен: без него элемент сетки не сжимается уже своего
    // содержимого, внутренняя прокрутка матрицы не срабатывает, и на телефоне
    // горизонтально едет вся страница, а не одна широкая таблица.
    <section className="flex min-w-0 flex-col gap-4 rounded-lg border p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-medium">Prompts × assistants</h2>
          <p className="max-w-prose text-sm text-muted-foreground">
            {MEASUREMENT_COPY.matrixBasis}
          </p>
        </div>

        <div className="flex items-center gap-2">
          <span className="metric rounded-full border px-2.5 py-1 text-[11px] text-muted-foreground">
            {matrix.windowDays} days · {matrix.totals.samples} answers
          </span>
          <div role="tablist" aria-label="Matrix view" className="flex gap-0.5 rounded-md bg-muted p-0.5">
            {VIEWS.map((option) => (
              <button
                key={option.id}
                type="button"
                role="tab"
                aria-selected={view === option.id}
                data-testid={`matrix-view-${option.id}`}
                onClick={() => setView(option.id)}
                className={cn(
                  "rounded px-2.5 py-1 text-xs",
                  view === option.id
                    ? "bg-background font-medium shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {view === "grid" && <MatrixGrid matrix={shown} />}
      {view === "bars" && <PresenceBars matrix={shown} />}
      {view === "cards" && <AssistantCards matrix={shown} />}

      <div className="flex flex-wrap items-center gap-4 border-t pt-3 text-[11px] text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="h-2.5 w-8 rounded-sm"
            style={{
              backgroundImage:
                "linear-gradient(90deg, color-mix(in oklch, var(--color-client) 10%, transparent), var(--color-client))",
            }}
          />
          0 → 100% of answers
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-competitor" />
          competitor named, client not
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="h-2.5 w-2.5 rounded-sm border border-dashed" />
          under the sample floor ({matrix.minSamples}+ answers)
        </span>
      </div>

      {unmeasured.length > 0 && (
        <p data-testid="unmeasured-note" className="text-[11px] text-muted-foreground">
          Not measured: {unmeasured.map((assistant) => assistant.label).join(", ")}. They have
          no public way to collect answers, so we do not ask them and report nothing either way.
        </p>
      )}
    </section>
  );
}
