import { C, CLIENT, EXPERIMENT, MATRIX, MATRIX_ASSISTANTS, MATRIX_OPTIONAL, type Series } from "./data";
import { MEASUREMENT_COPY } from "@repo/core";

/**
 * Графики витрины — инлайновым SVG, без библиотек: сборка герметична, а
 * интерактива здесь нет, и тянуть графическую библиотеку в бандл страницы,
 * которую читают, а не трогают, незачем.
 *
 * Семантика цвета та же, что в продукте: зелёная сплошная — клиент,
 * оранжевая пунктирная — конкуренты, серая точечная — нетронутые темы.
 * Узкие версии нарисованы отдельно, а не сжаты: на 375px подписи широкого
 * графика превращаются в пыль.
 */

const f1 = (v: number) => (Math.round(v * 10) / 10).toFixed(1);
const fx = (v: number) => v.toFixed(1);

interface LineChartProps {
  w: number;
  h: number;
  m: { l: number; r: number; t: number; b: number };
  ymax: number;
  yticks: number[];
  xlabels: string[];
  xEvery?: number;
  series: Series[];
  band?: { lo: number[]; hi: number[] };
  fs?: number;
  aria: string;
  vline?: { i: number; label: string };
  endLabels?: "full" | "name" | false;
}

function LineChart({
  w,
  h,
  m,
  ymax,
  yticks,
  xlabels,
  xEvery = 1,
  series,
  band,
  fs = 11,
  aria,
  vline,
  endLabels = "full",
}: LineChartProps) {
  const n = xlabels.length;
  const pw = w - m.l - m.r;
  const ph = h - m.t - m.b;
  const x = (i: number) => m.l + (i * pw) / (n - 1);
  const y = (v: number) => m.t + ph * (1 - v / ymax);
  const pts = (data: number[]) => data.map((v, i) => `${fx(x(i))},${fx(y(v))}`);

  // Клиент рисуется последним, поверх конкурентов.
  const order = [...series].sort((a, b) => Number(a.kind === "client") - Number(b.kind === "client"));

  // Подписи на конце линий раздвигаются, чтобы не налезать друг на друга.
  const labels = endLabels
    ? series
        .map((se) => ({
          se,
          ty: y(se.data[n - 1] ?? 0) + fs * 0.36,
          text: endLabels === "full" ? `${se.name} ${f1(se.data[n - 1] ?? 0)}` : se.name,
        }))
        .sort((a, b) => a.ty - b.ty)
    : [];
  for (let i = 1; i < labels.length; i++) {
    const prev = labels[i - 1]!;
    const cur = labels[i]!;
    if (cur.ty - prev.ty < fs + 3) cur.ty = prev.ty + fs + 3;
  }

  return (
    <svg className="chart" viewBox={`0 0 ${w} ${h}`} role="img" aria-label={aria}>
      <g stroke={C.grid}>
        {yticks
          .filter((t) => t > 0)
          .map((t) => (
            <line key={t} x1={m.l} y1={fx(y(t))} x2={w - m.r} y2={fx(y(t))} />
          ))}
      </g>
      <line x1={m.l} y1={y(0)} x2={w - m.r} y2={y(0)} stroke={C.base} />
      <g fill={C.muted} fontSize={fs} textAnchor="end">
        {yticks.map((t) => (
          <text key={t} x={m.l - 10} y={fx(y(t) + fs * 0.36)}>
            {t === 0 ? "0" : `${t}%`}
          </text>
        ))}
      </g>
      <g fill={C.muted} fontSize={fs} textAnchor="middle">
        {xlabels.map((label, i) =>
          i % xEvery === 0 || i === n - 1 ? (
            <text key={label} x={fx(x(i))} y={h - m.b + fs + 10}>
              {label}
            </text>
          ) : null,
        )}
      </g>
      {vline && (
        <>
          <line
            x1={fx(x(vline.i))}
            y1={m.t - 6}
            x2={fx(x(vline.i))}
            y2={y(0)}
            stroke={C.ink2}
            strokeDasharray="3 3"
          />
          <text x={fx(x(vline.i) + 6)} y={m.t + 4} fontSize={fs} fill={C.ink2}>
            {vline.label}
          </text>
        </>
      )}
      {band && (
        <path
          d={`M${pts(band.hi).join(" L")} L${pts(band.lo).reverse().join(" L")} Z`}
          fill="rgb(0 166 62 / .12)"
        />
      )}
      {order.map((se) => {
        const line = pts(se.data).join(" ");
        if (se.kind === "client") {
          const last = n - 1;
          const markers = se.markers !== false;
          return (
            <g key={se.name}>
              <polyline
                points={line}
                fill="none"
                stroke={C.client}
                strokeWidth={se.strokeWidth ?? 2.5}
                strokeLinejoin="round"
              />
              {markers && (
                <g fill={C.client}>
                  {se.data.slice(0, -1).map((v, i) => (
                    <circle key={i} cx={fx(x(i))} cy={fx(y(v))} r={3.1} />
                  ))}
                </g>
              )}
              <circle
                cx={fx(x(last))}
                cy={fx(y(se.data[last] ?? 0))}
                r={markers ? 5 : 3.6}
                fill={markers ? "#fff" : C.client}
                stroke={C.client}
                strokeWidth={markers ? 2.5 : 0}
              />
            </g>
          );
        }
        if (se.kind === "control") {
          return (
            <polyline
              key={se.name}
              points={line}
              fill="none"
              stroke={C.muted}
              strokeWidth={2}
              strokeDasharray="2 3"
              strokeLinejoin="round"
            />
          );
        }
        return (
          <polyline
            key={se.name}
            points={line}
            fill="none"
            stroke={C.comp}
            strokeWidth={se.strokeWidth ?? 1.5}
            strokeDasharray="5 4"
            opacity={se.opacity ?? 1}
          />
        );
      })}
      {labels.length > 0 && (
        <g fontSize={fs}>
          {labels.map((l) => (
            <text
              key={l.se.name}
              x={fx(x(n - 1) + 12)}
              y={fx(l.ty)}
              fill={l.se.kind === "client" ? C.clientInk : l.se.kind === "control" ? C.muted : C.compInk}
              fontWeight={l.se.kind === "client" ? 500 : undefined}
            >
              {l.text}
            </text>
          ))}
        </g>
      )}
    </svg>
  );
}

/** Эксперимент: темы, покрытые работой, против нетронутых. */
export function ExperimentChart({ actionLabel, actionLabelShort }: { actionLabel: string; actionLabelShort: string }) {
  const series: Series[] = [
    { name: "Covered topics", data: EXPERIMENT.treated, kind: "client" },
    { name: "Untouched", data: EXPERIMENT.untouched, kind: "control" },
  ];
  const aria =
    "Example data. Share of answers for topics the work covered, and for untouched topics, weeks 22 to 33. Both rise after week 27; the covered topics rise more.";
  const common = { ymax: 40, yticks: [0, 10, 20, 30, 40], xlabels: EXPERIMENT.weeks, series, aria };
  return (
    <>
      <div className="only-lg">
        <LineChart
          {...common}
          w={640}
          h={280}
          m={{ l: 50, r: 150, t: 26, b: 34 }}
          vline={{ i: EXPERIMENT.actionWeekIndex, label: actionLabel }}
        />
      </div>
      <div className="only-sm">
        <LineChart
          {...common}
          w={360}
          h={240}
          m={{ l: 36, r: 20, t: 26, b: 30 }}
          xEvery={3}
          fs={10.5}
          endLabels={false}
          vline={{ i: EXPERIMENT.actionWeekIndex, label: actionLabelShort }}
        />
      </div>
    </>
  );
}

/* ---------------- промпт × ассистент ---------------- */

function cellBackground(v: number): string {
  return `rgb(0 166 62 / ${(0.06 + (v / 100) * 0.5).toFixed(2)})`;
}

export function PromptMatrix() {
  return (
    <div className="mx-wrap">
      <table className="mx">
        <thead>
          <tr>
            <th scope="col">
              Prompt <span className="mono">· client: {CLIENT}</span>
            </th>
            {MATRIX_ASSISTANTS.map((a) => (
              <th key={a} scope="col">
                {a}
                {MATRIX_OPTIONAL.includes(a) && <span className="opt">switched on</span>}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {MATRIX.map((row) => (
            <tr key={row.prompt}>
              <th scope="row">{row.prompt}</th>
              {row.cells.map((v, i) => {
                const key = MATRIX_ASSISTANTS[i];
                if (v === null) {
                  return (
                    <td key={key} className="nm" title={MEASUREMENT_COPY.notMeasured}>
                      not measured
                    </td>
                  );
                }
                if (v === "floor") {
                  return (
                    <td key={key} className="fl" title={MEASUREMENT_COPY.underFloor}>
                      –
                    </td>
                  );
                }
                if (row.competitorOnly?.[i]) {
                  return (
                    <td key={key} className="co" title={MEASUREMENT_COPY.competitorOnly}>
                      {v}%<em>competitor named</em>
                    </td>
                  );
                }
                return (
                  <td key={key} style={{ background: cellBackground(v) }}>
                    {v}%
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
