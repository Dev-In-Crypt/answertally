import type { Metadata } from "next";
import Link from "next/link";
import {
  DIAGNOSIS_COPY,
  MARKETING_COPY,
  MEASUREMENT_COPY,
  OPPORTUNITY_COPY,
  SAMPLE_DELIVERY_REPORT,
  confidenceFor,
  delta,
  estimateExperiment,
  formatContributionRange,
  wilsonInterval,
} from "@repo/core";
import { Conf, LegendLine, MethodLink, SecHead, SrcChip } from "@/components/marketing/bits";
import { MarketingShell } from "@/components/marketing/chrome";
import { ExperimentChart, PromptMatrix } from "@/components/marketing/charts";
import {
  CLIENT,
  EXPERIMENT,
  MATRIX,
  MATRIX_SAMPLES,
  SOURCES,
  periodMean,
} from "@/components/marketing/data";
import { ReportPreview } from "@/components/marketing/report-preview";

/**
 * Страница продукта: шесть частей по порядку работы с клиентом.
 *
 * Все графики — пример на выдуманных данных и так подписаны. Отчёт в
 * карточке собран из примера отчёта и повторяет настоящий `ReportView`.
 * Раздел экспериментов показывает сам метод — сравнение с нетронутыми темами
 * клиента — на отдельном, тоже выдуманном примере, с теми же окнами, что в
 * расчёте продукта.
 */

export const metadata: Metadata = {
  alternates: { canonical: "/product" },
  title: "AI Visibility Platform for Agencies · Answertally",
  description:
    "Measure, diagnose, act, run experiments and report: how Answertally turns sampled AI answers into ranked agency work and white-label reports.",
};

const WL = MARKETING_COPY.whiteLabel;

/* Пример эксперимента считается той же математикой, что и в продукте (контракт C5). */
const treatedBefore = periodMean(EXPERIMENT.treated, EXPERIMENT.before);
const treatedAfter = periodMean(EXPERIMENT.treated, EXPERIMENT.after);
const untouchedBefore = periodMean(EXPERIMENT.untouched, EXPERIMENT.before);
const untouchedAfter = periodMean(EXPERIMENT.untouched, EXPERIMENT.after);
const estimate = estimateExperiment({
  treatmentBefore: treatedBefore,
  treatmentAfter: treatedAfter,
  controlBefore: untouchedBefore,
  controlAfter: untouchedAfter,
  treatmentSamplesAfter: (EXPERIMENT.after[1] - EXPERIMENT.after[0]) * 4 * 9,
  baselineSnapshots: EXPERIMENT.before[1] - EXPERIMENT.before[0],
  hasControlGroup: true,
  hasNewCitation: false,
});
const effectRange = formatContributionRange(estimate.incrementalPp) ?? "";

const weekSpan = ([from, to]: readonly [number, number]) =>
  `${EXPERIMENT.weeks[from]}–${EXPERIMENT.weeks[to - 1]}`;

/** Концы диапазона для полосы на оси: «+2–5 pp» → [2, 5]. */
function rangeEnds(range: string): [number, number] {
  const numbers = range.match(/\d+(\.\d+)?/g)?.map(Number) ?? [0];
  const sign = range.startsWith("−") ? -1 : 1;
  const [a = 0, b = a] = numbers;
  return [sign * a, sign * b].sort((x, y) => x - y) as [number, number];
}
const AXIS = { min: -2, max: 10 };
const toPct = (v: number) => ((v - AXIS.min) / (AXIS.max - AXIS.min)) * 100;
const [effectLo, effectHi] = rangeEnds(effectRange);

/* Пример ответа API — первая ячейка таблицы выше, интервал той же функцией, что в продукте. */
const API_CELL_PCT = MATRIX[0]?.cells[0];
const API_CELL = wilsonInterval(
  Math.round(((typeof API_CELL_PCT === "number" ? API_CELL_PCT : 0) / 100) * MATRIX_SAMPLES),
  MATRIX_SAMPLES,
);

const fmt1 = (v: number) => v.toFixed(1);
const fmtDelta = (v: number | null) =>
  v === null ? "–" : `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}`;

const FACTORS = [
  { label: OPPORTUNITY_COPY.factorLabels.impact, width: 82, value: "large" },
  { label: OPPORTUNITY_COPY.factorLabels.coverage, width: 38, value: "38%" },
  { label: OPPORTUNITY_COPY.factorLabels.commercialIntent, width: 75, value: "high" },
  { label: OPPORTUNITY_COPY.factorLabels.actionability, width: 50, value: "partly" },
  { label: OPPORTUNITY_COPY.factorLabels.confidence, width: 70, value: "medium" },
];

const OPPORTUNITIES = [
  {
    title: `Get ${CLIENT} covered on forum.example`,
    reason: `forum.example is cited in 12% of answers here (9 citations), and threads comparing the category name competitors without mentioning ${CLIENT}.`,
    impact: "medium",
    effort: "medium",
  },
  {
    title: "Publish a page that answers the comparison questions directly",
    reason: "no page from fernpost.example appears among the 9 sources cited for the comparison cluster, so there is nothing of the client's own to cite.",
    impact: "medium",
    effort: "medium",
  },
  {
    title: "Refresh the fernpost.example pricing page",
    reason: "the page is cited 6 times here, but the brand is not mentioned in those answers. It is being read without carrying the name.",
    impact: "medium",
    effort: "low",
  },
  {
    title: `Get ${CLIENT} covered on listings.example`,
    reason: "listings.example is cited in 7% of answers here (5 citations), with two competitors listed and the client absent.",
    impact: "medium",
    effort: "low",
  },
];

const ENDPOINTS = [
  { path: "/api/v1/clients", what: "Clients of your agency" },
  { path: "/api/v1/clients/{id}/visibility", what: "Prompt × assistant matrix, intervals, movement" },
  { path: "/api/v1/clients/{id}/sources", what: "Cited sources and presence" },
  { path: "/api/v1/clients/{id}/opportunities", what: "Ranked opportunities with reasons" },
  { path: "/api/v1/clients/{id}/actions", what: "Work queue with reasons" },
  { path: "/api/v1/reports", what: "Reports and their status" },
];

export default function ProductPage() {
  return (
    <MarketingShell active="product">
      <div className="wrap">
        <section className="p-hero">
          <div>
            <div className="kicker page-kicker">Product</div>
            <h1 className="display">
              From the answers assistants give <em>to the report your client approves.</em>
            </h1>
            <p className="lead">
              Six parts, run for each client: measure the answers, find the sources cited around them,
              rank the work, check what followed it, report it in your brand, and pull any of it into
              your own tools.
            </p>
            <nav className="jump" aria-label="On this page">
              <a href="#measure"><i>1</i>Measure</a>
              <a href="#diagnose"><i>2</i>Diagnose</a>
              <a href="#act"><i>3</i>Opportunities</a>
              <a href="#experiments"><i>4</i>Experiments</a>
              <a href="#reports"><i>5</i>Reports</a>
              <a href="#api"><i>6</i>API</a>
            </nav>
          </div>
          <aside className="card method" aria-label="Measurement method">
            <div className="cap">How every figure is made</div>
            <dl>
              <div><dt>Answers per question per assistant before a number shows</dt><dd>≥ 3</dd></div>
              <div><dt>Default cadence</dt><dd>every 2 weeks</dd></div>
              <div><dt>Answers grouped into</dt><dd>weekly windows</dd></div>
              <div><dt>Raw answer stored</dt><dd>every one</dd></div>
              <div><dt>Model version and cost recorded</dt><dd>per answer</dd></div>
              <div><dt>Figures from a single answer</dt><dd>none</dd></div>
            </dl>
            <div className="basis">{MARKETING_COPY.methodNote}</div>
            <MethodLink>The full method →</MethodLink>
          </aside>
        </section>
      </div>

      {/* 1 · измерение */}
      <section className="sec" id="measure">
        <div className="wrap">
          <SecHead n={1} title="Measure: every question, on every assistant you switch on">
            Write the questions your client’s buyers ask, import a list, or generate a draft from
            templates and edit it. Each question is asked several times on every assistant you switch
            on, and each cell is an aggregate of those answers. {MARKETING_COPY.cadence}
          </SecHead>
          <div className="card">
            <div className="panel-head">
              <span className="t">
                Prompt × assistant <span>· {CLIENT} · last 28 days, measured weekly · example data</span>
              </span>
              <Conf level={confidenceFor(MATRIX_SAMPLES)} />
            </div>
            <div className="panel-body">
              <PromptMatrix />
            </div>
            <div className="panel-foot">
              <div className="mx-legend">
                <span>
                  <i className="sw" style={{ background: "linear-gradient(90deg,rgb(0 166 62/.08),rgb(0 166 62/.56))" }} />
                  share of answers naming {CLIENT}
                </span>
                <span>
                  <i className="sw" style={{ background: "#FFF1E7", border: "1px dashed #F54900" }} />
                  a competitor named, {CLIENT} not
                </span>
                <span>
                  <i className="sw" style={{ background: "#fff", border: "1px solid #E3E1DA" }} />
                  fewer than 3 answers, so no number
                </span>
              </div>
              <div className="label">{MEASUREMENT_COPY.matrixBasis}</div>
              <div className="label only-sm">Scroll the table sideways to see every assistant →</div>
            </div>
          </div>
          <div className="facts">
            <div className="card fact">
              <b>2 + 4</b>
              <span>
                ChatGPT and Perplexity by default. Switched on per client: Grok, Google AI Overviews
                (the AI answer above Google results) and Google AI Mode on any plan, Claude from
                Growth.
              </span>
            </div>
            <div className="card fact">
              <b>≥ 3</b>
              <span>answers per question per assistant before a cell shows a number.</span>
            </div>
            <div className="card fact">
              <b>2 weeks</b>
              <span>between measurements by default. Weekly or daily if you switch it on.</span>
            </div>
            <div className="card fact">
              <b>Kept</b>
              <span>every raw answer, with its model version and cost.</span>
            </div>
          </div>
        </div>
      </section>

      {/* 2 · диагностика */}
      <section className="sec" id="diagnose">
        <div className="wrap">
          <SecHead n={2} title="Diagnose: which sources are cited where competitors are named">
            Every answer comes with the pages it cited. Grouped by kind of source, they show where
            competitors are named and your client is not, and whether the gap sits on the client’s
            own site or out in the category.
          </SecHead>
          <div className="split rev">
            <div className="card srcs">
              <div>
                <div className="ev-title">Cited sources · {CLIENT} · example data</div>
                <div className="label" style={{ marginTop: 2 }}>
                  share of answers citing each source · last 28 days
                </div>
              </div>
              <ul>
                {SOURCES.map((s, i) => (
                  <li key={s.domain}>
                    <div className="row">
                      <SrcChip n={i + 1} domain={s.domain} kind={s.kind} note={s.note} />
                      <span className="pct">{s.pct}%</span>
                    </div>
                    <span className="bar">
                      <i
                        style={{
                          width: `${s.pct * 4}%`,
                          background: s.kind === "gap" ? "#F54900" : s.note === "names client" ? "#00A63E" : "#3C414B",
                          opacity: s.kind === "gap" ? 0.75 : s.note === "names client" ? 1 : 0.55,
                        }}
                      />
                    </span>
                  </li>
                ))}
              </ul>
              <div className="basis" style={{ marginTop: "auto" }}>
                {MARKETING_COPY.gapDefinition}
              </div>
            </div>
            <div className="card verdict">
              <div className="kicker">Diagnosis · {CLIENT}</div>
              <p className="h3">{DIAGNOSIS_COPY.thirdPartyGap}</p>
              <div className="cites">
                <SrcChip n={1} domain="reviewhub.example" kind="gap" note="gap" />
                <SrcChip n={2} domain="forum.example" kind="gap" note="gap" />
                <SrcChip n={3} domain="toolreview.example" kind="has" note="names both" />
              </div>
              <div className="basis" style={{ marginTop: "auto" }}>
                {DIAGNOSIS_COPY.evidenceNote} {DIAGNOSIS_COPY.presenceCaveat}
              </div>
            </div>
          </div>
          <div className="tape">
            <div className="tape-head">
              <span className="kicker">Evidence · answers citing reviewhub.example</span>
              <span className="label">examples from the sample, shown after the aggregate</span>
            </div>
            <div className="tape-item">
              <div className="src"><span>Perplexity · answer 1 of 3</span><span>23 Jun</span></div>
              <q>
                Most reviewers recommend <span className="nm-comp">Quillstack</span>, with{" "}
                <span className="nm-comp">Loambox</span> as a cheaper option …
              </q>
              <div className="cites"><SrcChip n={1} domain="reviewhub.example" kind="gap" note="gap" /></div>
            </div>
            <div className="tape-item">
              <div className="src"><span>ChatGPT · answer 2 of 3</span><span>24 Jun</span></div>
              <q>
                Reviewers rate <span className="nm-comp">Quillstack</span> highest for larger teams;{" "}
                <span className="nm-comp">Tidepin</span> suits freelancers …
              </q>
              <div className="cites">
                <SrcChip n={2} domain="reviewhub.example" kind="gap" note="gap" />
                <SrcChip n={3} domain="tidepin.example" kind="plain" />
              </div>
            </div>
            <div className="tape-item">
              <div className="src"><span>Grok · answer 3 of 3</span><span>25 Jun</span></div>
              <q>
                On review sites, <span className="nm-comp">Loambox</span> and{" "}
                <span className="nm-comp">Quillstack</span> collect the most studio reviews …
              </q>
              <div className="cites"><SrcChip n={1} domain="reviewhub.example" kind="gap" note="gap" /></div>
            </div>
          </div>
        </div>
      </section>

      {/* 3 · возможности и работа */}
      <section className="sec" id="act">
        <div className="wrap">
          <SecHead n={3} title="Opportunities: ranked work, each with a reason">
            {OPPORTUNITY_COPY.basis} No opportunity and no action exists without a reason.
          </SecHead>
          <div className="split rev">
            <div className="card">
              <div className="panel-head">
                <span className="t">
                  Opportunities <span>· {CLIENT} · example data</span>
                </span>
                <span className="label">5 of 11</span>
              </div>
              <ol className="opps">
                <li>
                  <span className="rk">1</span>
                  <div>
                    <h4>Get {CLIENT} covered on reviewhub.example</h4>
                    <p className="why">
                      <b>Reason:</b> reviewhub.example is cited in 18% of answers for this category
                      (14 citations). Quillstack and Loambox appear in those answers; {CLIENT} does
                      not.
                    </p>
                    <div className="tags">
                      <span className="tag">estimated impact: high</span>
                      <span className="tag">effort: medium</span>
                      <span className="tag">type: review platform</span>
                    </div>
                    <div className="factors" aria-label="Why it ranks first">
                      {FACTORS.map((f) => (
                        <div key={f.label}>
                          <span>{f.label}</span>
                          <span className="bar">
                            <i style={{ width: `${f.width}%`, background: "#3C414B" }} />
                          </span>
                          <span>{f.value}</span>
                        </div>
                      ))}
                      <span className="label">{OPPORTUNITY_COPY.coverageBasis}</span>
                    </div>
                  </div>
                </li>
                {OPPORTUNITIES.map((o, i) => (
                  <li key={o.title}>
                    <span className="rk">{i + 2}</span>
                    <div>
                      <h4>{o.title}</h4>
                      <p className="why">
                        <b>Reason:</b> {o.reason}
                      </p>
                      <div className="tags">
                        <span className="tag">estimated impact: {o.impact}</span>
                        <span className="tag">effort: {o.effort}</span>
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            </div>

            <div className="side">
              <div className="card pad">
                <div className="cap" style={{ marginBottom: 12 }}>
                  Actions board · this sprint · example
                </div>
                <div className="board">
                  <div className="bcol">
                    <h3>Backlog <span>2</span></h3>
                    <div className="tks">
                      <div className="tk">
                        <b>Review listing</b>
                        <span>Reason: reviewhub.example cited in 18% of answers</span>
                        <div className="who"><i>AK</i>owner</div>
                      </div>
                      <div className="tk">
                        <b>Comparison page</b>
                        <span>Reason: no own page among 9 cited sources</span>
                        <div className="who"><i>MR</i>owner</div>
                      </div>
                    </div>
                  </div>
                  <div className="bcol">
                    <h3>In progress <span>1</span></h3>
                    <div className="tks">
                      <div className="tk">
                        <b>Pricing page refresh</b>
                        <span>Reason: cited 6 times, name not carried</span>
                        <div className="who"><i>JS</i>owner</div>
                      </div>
                    </div>
                  </div>
                  <div className="bcol">
                    <h3>Done <span>3</span></h3>
                    <div className="tks">
                      <div className="tk">
                        <b>Migration guide</b>
                        <span>Reason: 3 answers send migrations to a competitor</span>
                        <div className="who"><i>AK</i>done</div>
                      </div>
                      <span className="more">+ 2 more</span>
                    </div>
                  </div>
                </div>
                <div className="ctrl">
                  <b>Untouched topics · invoicing, time tracking.</b> This sprint’s work does not
                  touch them, so they are what later movement gets compared with.
                </div>
              </div>
              <ul className="rules" style={{ marginTop: 22 }}>
                <li>
                  <span>
                    <b>Every action opens as a brief</b>: the objective, why it matters, the numbers
                    behind it, steps and acceptance criteria for its type.
                  </span>
                </li>
                <li>
                  <span>
                    <b>Dismissing needs a reason too</b>, so the next person does not re-open it.{" "}
                    {OPPORTUNITY_COPY.dismissReturns}
                  </span>
                </li>
                <li>
                  <span>
                    <b>“{OPPORTUNITY_COPY.snoozeLabel}”</b>: {OPPORTUNITY_COPY.snoozeNote}
                  </span>
                </li>
                <li>
                  <span>
                    <b>Nothing is published for you.</b> The board records work your team does; any
                    change to a client’s site stays a human decision.
                  </span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* 4 · эксперименты */}
      <section className="sec" id="experiments">
        <div className="wrap">
          <SecHead n={4} title="Experiments: what followed the work, as an estimate">
            {MARKETING_COPY.experimentMethod}
          </SecHead>
          <div className="card exp" data-testid="experiment-example">
            <div className="exp-chart">
              <div className="ev-title">
                Migration guide refresh <span>· {CLIENT} · marked done {EXPERIMENT.weeks[EXPERIMENT.after[0]]} · example data</span>
              </div>
              <div className="legend">
                <span>
                  <LegendLine kind="client" />
                  Topics the guide covers
                </span>
                <span>
                  <LegendLine kind="control" />
                  Untouched topics: invoicing, time tracking
                </span>
              </div>
              <ExperimentChart
                actionLabel="Guide marked done · W27"
                actionLabelShort="Marked done · W27"
              />
              <div className="basis">
                Before: the {EXPERIMENT.baselineDays} days before the work was marked done (
                {weekSpan(EXPERIMENT.before)}) · after: every week since ({weekSpan(EXPERIMENT.after)}) · 3
                assistants × 3 samples per question
              </div>
            </div>
            <div className="exp-side">
              <div>
                <div className="cap">Estimated incremental effect</div>
                <div className="big-range">
                  {effectRange.replace(/\s*pp$/, "")}
                  <small> pp</small>
                </div>
                <div
                  className="range"
                  role="img"
                  aria-label={`Band from ${effectLo} to ${effectHi} points on an axis from ${AXIS.min} to ${AXIS.max}`}
                >
                  <div className="axis" />
                  <div className="zero" style={{ left: `${toPct(0)}%` }} />
                  <div
                    className="span"
                    style={{ left: `${toPct(effectLo)}%`, width: `${toPct(effectHi) - toPct(effectLo)}%` }}
                  />
                  <span className="tk2 start" style={{ left: 0 }}>−2</span>
                  <span className="tk2" style={{ left: `${toPct(0)}%` }}>0</span>
                  <span className="tk2" style={{ left: `${toPct(4)}%` }}>+4</span>
                  <span className="tk2 end" style={{ left: "100%" }}>+10</span>
                </div>
                <p className="label" style={{ marginTop: 6 }}>
                  {MARKETING_COPY.contributionBand}
                </p>
              </div>
              <Conf level={estimate.confidence} />
              <table className="ba">
                <thead>
                  <tr><th>Topics</th><th>Before</th><th>After</th><th>Change</th></tr>
                </thead>
                <tbody>
                  <tr>
                    <td>Covered by the guide</td>
                    <td>{fmt1(treatedBefore)}%</td>
                    <td>{fmt1(treatedAfter)}%</td>
                    <td>{fmtDelta(delta(treatedBefore, treatedAfter))}</td>
                  </tr>
                  <tr>
                    <td>Untouched</td>
                    <td>{fmt1(untouchedBefore)}%</td>
                    <td>{fmt1(untouchedAfter)}%</td>
                    <td>{fmtDelta(delta(untouchedBefore, untouchedAfter))}</td>
                  </tr>
                  <tr>
                    <td>Difference</td>
                    <td />
                    <td />
                    <td>{fmtDelta(estimate.incrementalPp)}</td>
                  </tr>
                </tbody>
              </table>
              <p className="small">{MARKETING_COPY.experimentRecord}</p>
              <p className="label">{MARKETING_COPY.experimentWithoutControl}</p>
            </div>
          </div>
        </div>
      </section>

      {/* 5 · отчёты */}
      <section className="sec" id="reports">
        <div className="wrap">
          <SecHead n={5} title="White-label reports, in your agency’s name">
            A report is a page your client opens from a link, without an account, in your logo and
            color. You can download the same page as a PDF to forward.
          </SecHead>
          <div className="split">
            <div className="side">
              <h3 className="h3">What the client can do</h3>
              <ul className="never">
                <li>Open the report from a link, with no account and no login</li>
                <li>Approve the report and the next sprint in it; the name and date are recorded</li>
                <li>Read the caveats in the “How to read this” section at the end</li>
              </ul>
              <h3 className="h3" style={{ marginTop: 32 }}>
                What the report page never shows
              </h3>
              <ul className="never x">
                <li>Our name or logo</li>
                <li>“Powered by” or any link back to us</li>
                <li>Pricing, plan names or upsell messages</li>
              </ul>
              <ul className="rules" style={{ marginTop: 20 }}>
                <li>
                  <span>
                    <b>Worth knowing.</b> {WL.link} {WL.email}
                  </span>
                </li>
                <li>
                  <span>
                    <b>What always stays.</b> Figures are called estimates, the measurement basis is
                    stated, and the caveats close the report. In an audit report every ranked item
                    carries its reason; a quarterly report’s next sprint is the plan you agree with
                    the client.
                  </span>
                </li>
              </ul>
            </div>
            <div className="wl-stage">
              <ReportPreview
                payload={SAMPLE_DELIVERY_REPORT}
                variant="delivery"
                testId="product-report"
                ariaLabel="Example white-label quarterly report, abridged"
                initial={1}
                approve
              />
              <Link className="link" href="/sample-report">
                Open the full example report →
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* 6 · API */}
      <section className="sec" id="api">
        <div className="wrap">
          <SecHead n={6} title="API: the same numbers, in your own tools">
            A read-only REST API for your agency’s data. Responses carry the same intervals, sample
            counts and reasons as the screens, so a figure does not lose its basis when it lands in
            another dashboard.
          </SecHead>
          <div className="split even">
            <div className="card pad">
              <div className="cap" style={{ marginBottom: 6 }}>
                Endpoints · GET · Bearer key
              </div>
              <table className="ep">
                <tbody>
                  {ENDPOINTS.map((e) => (
                    <tr key={e.path}>
                      <td className="m">GET</td>
                      <td className="p">{e.path}</td>
                      <td className="w">{e.what}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="basis" style={{ marginTop: 12 }}>
                A key is shown once, right after it is created; only a hash of it is stored. Another
                agency’s client returns “not found”.
              </div>
            </div>
            <pre className="code" aria-label="Example request and abridged response">
              <span className="c"># window: 7–90 days, default 28</span>
              {"\ncurl https://answertally.com/api/v1/clients/"}
              <span className="n">cl_8f2a</span>
              {"/visibility?windowDays=28 \\\n  -H "}
              <span className="s">&quot;Authorization: Bearer $ANSWERTALLY_KEY&quot;</span>
              {"\n\n"}
              <span className="c">{"// abridged, illustrative response"}</span>
              {"\n{\n  "}
              <span className="k">&quot;data&quot;</span>
              {": {\n    "}
              <span className="k">&quot;client&quot;</span>: <span className="s">&quot;{CLIENT}&quot;</span>
              {",\n    "}
              <span className="k">&quot;windowDays&quot;</span>: <span className="n">28</span>
              {",\n    "}
              <span className="k">&quot;cells&quot;</span>
              {": [\n      {\n        "}
              <span className="k">&quot;prompt&quot;</span>:{" "}
              <span className="s">&quot;best project tool for a small design studio&quot;</span>
              {",\n        "}
              <span className="k">&quot;platform&quot;</span>: <span className="s">&quot;chatgpt&quot;</span>
              {",\n        "}
              <span className="k">&quot;sharePct&quot;</span>: <span className="n">{API_CELL?.pct}</span>
              {",\n        "}
              <span className="k">&quot;interval&quot;</span>: [<span className="n">{API_CELL?.low}</span>,{" "}
              <span className="n">{API_CELL?.high}</span>]
              {",\n        "}
              <span className="k">&quot;samples&quot;</span>: <span className="n">{MATRIX_SAMPLES}</span>
              {",\n        "}
              <span className="k">&quot;sufficient&quot;</span>: <span className="n">true</span>
              {"\n      }\n    ]\n  }\n}"}
            </pre>
          </div>
        </div>
      </section>

      <section className="sec">
        <div className="wrap closing">
          <h2 className="h1">See it on one of your own clients first</h2>
          <div>
            <p className="prose">
              The free audit runs the first steps once, from questions to ranked work, and ends on an
              opportunity report in your brand. Nothing is charged to run it.
            </p>
            <div className="ctas" style={{ marginTop: 22 }}>
              <Link className="btn primary" href="/signup">
                Run a free audit
              </Link>
              <Link className="link" href="/pricing">
                See pricing →
              </Link>
            </div>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
