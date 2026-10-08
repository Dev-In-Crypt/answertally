import { formatDay } from "@repo/core";

/**
 * Диаграммы клиентского отчёта. Чистый SVG и CSS без скриптов: страница
 * открывается без входа и печатается в PDF той же разметкой (см. report-view).
 *
 * Цвет клиента — цвет агентства (`--primary`), конкуренты — оранжевым, как во
 * всём продукте; у ассистентов свои постоянные цвета. Каждая диаграмма несёт
 * числа текстом рядом с цветом: цвет помогает, но смысл не держит.
 */

/**
 * Постоянный цвет ассистента: один и тот же в любом отчёте и любом порядке.
 * Набор проверен валидатором палитры (различимость, в т.ч. при дальтонизме);
 * оранжевого среди них нет — он закреплён за конкурентами.
 */
const ASSISTANT_COLORS: Record<string, string> = {
  chatgpt: "#1baf7a",
  perplexity: "#2a78d6",
  "ai-overviews": "#eda100",
  "ai-mode": "#4a3aa7",
  claude: "#e87ba4",
  grok: "#008300",
};
const FALLBACK_COLOR = "#64748b";
const COMPETITOR_COLOR = "var(--competitor)";
const UP_COLOR = "#008300";
const DOWN_COLOR = "#e34948";

export function assistantColor(id: string): string {
  return ASSISTANT_COLORS[id] ?? FALLBACK_COLOR;
}

const pct = (value: number) => `${Math.round(value * 10) / 10}%`;

/** Кольцо: доля ответов, где назван клиент. */
export function ShareRing({
  sharePct,
  caption,
}: {
  sharePct: number;
  caption: string;
}) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const filled = (Math.min(100, Math.max(0, sharePct)) / 100) * c;
  return (
    <figure className="flex items-center gap-5" data-testid="chart-share-ring">
      <svg viewBox="0 0 128 128" className="h-32 w-32 shrink-0" role="img" aria-label={`${pct(sharePct)} ${caption}`}>
        <circle cx="64" cy="64" r={r} fill="none" stroke="currentColor" strokeOpacity="0.1" strokeWidth="14" />
        <circle
          cx="64"
          cy="64"
          r={r}
          fill="none"
          stroke="var(--primary)"
          strokeWidth="14"
          strokeLinecap="round"
          strokeDasharray={`${filled} ${c}`}
          transform="rotate(-90 64 64)"
        />
        {/* Та же точность, что у цифр рядом: 29% под 28.6% читалось бы как другая цифра. */}
        <text x="64" y="70" textAnchor="middle" className="metric" fontSize="20" fontWeight="600" fill="currentColor">
          {pct(sharePct)}
        </text>
      </svg>
      <figcaption className="text-sm text-muted-foreground">{caption}</figcaption>
    </figure>
  );
}

interface Bar {
  key: string;
  label: string;
  value: number;
  color: string;
  note?: string;
  strong?: boolean;
}

/** Горизонтальные полосы с подписью и числом в строке. Шкала — 0–100%. */
export function BarList({ bars, testId }: { bars: Bar[]; testId?: string }) {
  return (
    <ul data-testid={testId} className="flex flex-col gap-2.5 text-sm">
      {bars.map((bar) => (
        <li key={bar.key} className="grid grid-cols-[minmax(0,9rem)_1fr_auto] items-center gap-3">
          <span className={`truncate ${bar.strong ? "font-semibold" : ""}`} title={bar.label}>
            {bar.label}
          </span>
          <span className="h-3 overflow-hidden rounded-full bg-muted" title={`${bar.label}: ${pct(bar.value)}`}>
            <span
              className="block h-full rounded-full"
              style={{ width: `${Math.min(100, Math.max(0, bar.value))}%`, background: bar.color, minWidth: bar.value > 0 ? 4 : 0 }}
            />
          </span>
          <span className="metric whitespace-nowrap text-right font-medium">
            {pct(bar.value)}
            {bar.note && <span className="ml-1 font-normal text-muted-foreground">{bar.note}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Клиент против конкурентов: клиент цветом агентства, конкуренты оранжевым. */
export function CompetitorBars({
  clientName,
  clientPct,
  competitors,
}: {
  clientName: string;
  clientPct: number;
  competitors: { name: string; sharePct: number }[];
}) {
  const bars: Bar[] = [
    { key: "__client", label: clientName, value: clientPct, color: "var(--primary)", strong: true },
    ...competitors.map((c) => ({ key: c.name, label: c.name, value: c.sharePct, color: COMPETITOR_COLOR })),
  ].sort((a, b) => b.value - a.value);
  return <BarList bars={bars} testId="chart-competitors" />;
}

/** Доля по ассистентам: у каждого свой цвет и число ответов рядом. */
export function AssistantBars({
  rows,
  labels,
}: {
  rows: { assistant: string; sharePct: number; answers: number }[];
  labels: Record<string, string>;
}) {
  return (
    <BarList
      testId="chart-assistants"
      bars={rows.map((row) => ({
        key: row.assistant,
        label: labels[row.assistant] ?? row.assistant,
        value: row.sharePct,
        color: assistantColor(row.assistant),
        note: `· ${row.answers} answers`,
      }))}
    />
  );
}

/**
 * Линия доли по неделям. Шкала от нуля: обрезанная ось превращает шаг в
 * два пункта в обрыв, а отчёт клиенту не должен рисовать больше, чем есть.
 */
export function TrendLine({ points }: { points: { weekStart: string; sharePct: number }[] }) {
  const w = 600;
  const h = 180;
  const pad = { l: 36, r: 12, t: 12, b: 26 };
  const top = Math.max(10, Math.ceil(Math.max(...points.map((p) => p.sharePct)) / 10) * 10);
  const x = (i: number) => pad.l + (points.length === 1 ? 0 : (i / (points.length - 1)) * (w - pad.l - pad.r));
  const y = (v: number) => pad.t + (1 - v / top) * (h - pad.t - pad.b);
  const line = points.map((p, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)},${y(p.sharePct).toFixed(1)}`).join(" ");
  const area = `${line} L${x(points.length - 1).toFixed(1)},${y(0)} L${x(0).toFixed(1)},${y(0)} Z`;
  const ticks = [0, top / 2, top];
  const first = points[0]!;
  const last = points.at(-1)!;
  return (
    <figure data-testid="chart-trend">
      <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full" role="img" aria-label={`Share of answers by week, from ${pct(first.sharePct)} to ${pct(last.sharePct)}`}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={w - pad.r} y1={y(t)} y2={y(t)} stroke="currentColor" strokeOpacity="0.1" />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize="11" fill="currentColor" fillOpacity="0.55">
              {Math.round(t)}%
            </text>
          </g>
        ))}
        <path d={area} fill="var(--primary)" fillOpacity="0.12" />
        <path d={line} fill="none" stroke="var(--primary)" strokeWidth="2.5" strokeLinejoin="round" />
        {points.map((p, i) => (
          <circle key={p.weekStart} cx={x(i)} cy={y(p.sharePct)} r="4.5" fill="var(--primary)" stroke="white" strokeWidth="2">
            <title>{`Week of ${formatDay(new Date(p.weekStart))}: ${pct(p.sharePct)}`}</title>
          </circle>
        ))}
        <text x={x(0)} y={h - 6} fontSize="11" fill="currentColor" fillOpacity="0.55">
          {formatDay(new Date(first.weekStart))}
        </text>
        <text x={x(points.length - 1)} y={h - 6} textAnchor="end" fontSize="11" fill="currentColor" fillOpacity="0.55">
          {formatDay(new Date(last.weekStart))}
        </text>
        <text x={x(points.length - 1)} y={y(last.sharePct) - 10} textAnchor="end" fontSize="13" fontWeight="600" fill="currentColor">
          {pct(last.sharePct)}
        </text>
      </svg>
    </figure>
  );
}

/** Изменение по вопросу: зелёная полоса вправо — рост, красная влево — спад. */
export function DeltaBar({ deltaPp, maxAbs }: { deltaPp: number; maxAbs: number }) {
  const width = maxAbs === 0 ? 0 : (Math.abs(deltaPp) / maxAbs) * 50;
  return (
    <span className="relative block h-2.5 w-24 shrink-0 rounded-full bg-muted" aria-hidden>
      <span className="absolute inset-y-0 left-1/2 w-px bg-foreground/30" />
      <span
        className="absolute inset-y-0 rounded-full"
        style={{
          background: deltaPp >= 0 ? UP_COLOR : DOWN_COLOR,
          width: `${width}%`,
          left: deltaPp >= 0 ? "50%" : `${50 - width}%`,
        }}
      />
    </span>
  );
}
