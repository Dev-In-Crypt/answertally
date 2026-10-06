import type { Metadata } from "next";
import Link from "next/link";
import {
  BASELINE_WINDOW_DAYS,
  MARKETING_COPY,
  MEASUREMENT_COPY,
  METHOD_COPY,
  MIN_SAMPLES_PER_CELL,
  SAMPLE_CONFIDENCE_THRESHOLDS,
  confidenceFor,
  wilsonInterval,
} from "@repo/core";
import { Conf, SecHead } from "@/components/marketing/bits";
import { MarketingShell } from "@/components/marketing/chrome";
import { LIMITS, SPARKTORO_STUDY } from "@/components/marketing/content";

/**
 * Методология — главный актив доверия: как мы сэмплируем, что значат
 * диапазон и уверенность, почему нет «позиции», кого не измеряем и чего
 * никогда не утверждаем.
 *
 * Числа берутся из констант продукта, а не пишутся руками: порог сэмплов,
 * пороги уверенности, окно baseline. Примеры диапазонов считаются той же
 * функцией Уилсона, что в продукте. Тексты — из `METHOD_COPY` в copy.ts.
 */

export const metadata: Metadata = {
  alternates: { canonical: "/method" },
  title: "How We Measure AI Visibility · Answertally",
  description:
    "How Answertally measures AI visibility: repeated samples per question and assistant, ranges and confidence levels, no rank, no single score.",
};

const MEDIUM = SAMPLE_CONFIDENCE_THRESHOLDS.medium;
const HIGH = SAMPLE_CONFIDENCE_THRESHOLDS.high;

/** Одна и та же доля на разном числе ответов: диапазон сужается, уверенность растёт. */
const RANGE_EXAMPLES = [
  { named: 2, answers: 6 },
  { named: 4, answers: 12 },
  { named: 40, answers: 120 },
].map(({ named, answers }) => {
  const interval = wilsonInterval(named, answers);
  return {
    named,
    answers,
    pct: Math.round(interval?.pct ?? 0),
    low: Math.round(interval?.low ?? 0),
    high: Math.round(interval?.high ?? 0),
    confidence: confidenceFor(answers),
  };
});

const CONFIDENCE_ROWS = [
  { level: "low" as const, answers: `fewer than ${MEDIUM}` },
  { level: "medium" as const, answers: `${MEDIUM} to ${HIGH - 1}` },
  { level: "high" as const, answers: `${HIGH} or more` },
];

export default function MethodPage() {
  return (
    <MarketingShell active="method">
      <div className="wrap">
        <section className="p-hero">
          <div>
            <div className="kicker page-kicker">Method</div>
            <h1 className="display">
              How we measure, <em>and what we never claim.</em>
            </h1>
            <p className="lead">{METHOD_COPY.lead}</p>
            <nav className="jump" aria-label="On this page">
              <a href="#rank"><i>1</i>No rank</a>
              <a href="#sampling"><i>2</i>Sampling</a>
              <a href="#ranges"><i>3</i>Ranges</a>
              <a href="#confidence"><i>4</i>Confidence</a>
              <a href="#experiments"><i>5</i>Experiments</a>
              <a href="#kept"><i>6</i>What we keep</a>
              <a href="#never"><i>7</i>Never claimed</a>
            </nav>
          </div>
          <aside className="card method" aria-label="Method at a glance" data-testid="method-summary">
            <div className="cap">At a glance</div>
            <dl>
              <div><dt>Answers per question per assistant before a number shows</dt><dd>≥ {MIN_SAMPLES_PER_CELL}</dd></div>
              <div><dt>Default cadence</dt><dd>every 2 weeks</dd></div>
              <div><dt>Answers grouped into</dt><dd>weekly windows</dd></div>
              <div><dt>Range on a share</dt><dd>95% interval</dd></div>
              <div><dt>Confidence comes from</dt><dd>number of answers</dd></div>
              <div><dt>Kept per answer</dt><dd>text, sources, model, cost</dd></div>
            </dl>
            <div className="basis">{MARKETING_COPY.methodNote}</div>
          </aside>
        </section>
      </div>

      {/* 1 · почему нет позиции */}
      <section className="sec" id="rank">
        <div className="wrap">
          <SecHead n={1} title="Why there is no “rank in ChatGPT”">
            {METHOD_COPY.noRank}
          </SecHead>
          <div className="g2">
            <figure className="market-note" style={{ margin: 0 }}>
              <blockquote>{METHOD_COPY.sparkToro}</blockquote>
              <figcaption>
                <a href={SPARKTORO_STUDY.href} rel="noopener noreferrer" target="_blank">
                  {SPARKTORO_STUDY.label}
                </a>
              </figcaption>
            </figure>
            <ul className="rules">
              <li>
                <span>
                  <b>What we report instead.</b> {METHOD_COPY.instead}
                </span>
              </li>
              <li>
                <span>
                  <b>How the client is named.</b> {METHOD_COPY.prominence}
                </span>
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* 2 · как сэмплируем */}
      <section className="sec" id="sampling">
        <div className="wrap">
          <SecHead n={2} title="How we sample">
            Visibility is only as good as the questions and the number of answers behind it.
          </SecHead>
          <div className="split even">
            <ul className="rules">
              <li>
                <span>
                  <b>Questions.</b> {METHOD_COPY.questions}
                </span>
              </li>
              <li>
                <span>
                  <b>Samples.</b> {METHOD_COPY.samples}
                </span>
              </li>
              <li>
                <span>
                  <b>Cadence.</b> {MARKETING_COPY.cadence}
                </span>
              </li>
              <li>
                <span>
                  <b>Through the API.</b> {METHOD_COPY.api}
                </span>
              </li>
              <li>
                <span>
                  <b>Sources.</b> {METHOD_COPY.sources}
                </span>
              </li>
            </ul>
            <div className="card pad" data-testid="method-assistants">
              <div className="cap" style={{ marginBottom: 10 }}>
                Assistants
              </div>
              <p className="small" style={{ marginBottom: 8 }}>Measured by default</p>
              <div className="chip-row">
                <span className="a-chip">ChatGPT</span>
                <span className="a-chip">Perplexity</span>
                <span className="a-chip">Grok</span>
              </div>
              <p className="small" style={{ margin: "16px 0 8px" }}>
                Switched on per client from the Growth plan, using more AI checks rather than costing extra
              </p>
              <div className="chip-row">
                <span className="a-chip opt">Claude</span>
              </div>
              <p className="small" style={{ margin: "16px 0 8px" }}>Not measured</p>
              <div className="chip-row">
                <span className="a-chip off">Copilot</span>
                <span className="a-chip off">AI Overviews</span>
                <span className="a-chip off">AI Mode</span>
              </div>
              <div className="basis" style={{ marginTop: 16 }}>
                {MARKETING_COPY.notMeasuredSurfaces}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* 3 · окна и диапазоны */}
      <section className="sec" id="ranges">
        <div className="wrap">
          <SecHead n={3} title="Windows and ranges">
            {METHOD_COPY.windows}
          </SecHead>
          <div className="split even">
            <ul className="rules">
              <li>
                <span>
                  <b>The range.</b> {METHOD_COPY.interval}
                </span>
              </li>
              <li>
                <span>
                  <b>Up, down, or can’t tell.</b> {METHOD_COPY.withinNoise}
                </span>
              </li>
            </ul>
            <div className="card pad range-demo" data-testid="method-range-example">
              <div className="cap" style={{ marginBottom: 12 }}>
                The same share on more answers
              </div>
              {RANGE_EXAMPLES.map((ex) => (
                <div className="rd-row" key={ex.answers}>
                  <div className="rd-top">
                    <span>
                      {ex.named} of {ex.answers} answers name the client
                    </span>
                    <b>
                      {ex.pct}% <small>range {ex.low}–{ex.high}%</small>
                    </b>
                  </div>
                  <div className="rd-axis" aria-hidden>
                    <i className="rd-band" style={{ left: `${ex.low}%`, width: `${ex.high - ex.low}%` }} />
                    <i className="rd-dot" style={{ left: `${ex.pct}%` }} />
                  </div>
                  <Conf level={ex.confidence} />
                </div>
              ))}
              <div className="basis">{METHOD_COPY.rangeExampleNote}</div>
            </div>
          </div>
        </div>
      </section>

      {/* 4 · уверенность */}
      <section className="sec" id="confidence">
        <div className="wrap">
          <SecHead n={4} title="What confidence means">
            {METHOD_COPY.confidence}
          </SecHead>
          <div className="card pad conf-table-card">
            <table className="ba" data-testid="method-confidence">
              <thead>
                <tr>
                  <th>Label</th>
                  <th>Answers behind the figure</th>
                </tr>
              </thead>
              <tbody>
                {CONFIDENCE_ROWS.map((row) => (
                  <tr key={row.level}>
                    <td>
                      <Conf level={row.level} estimated={false} />
                    </td>
                    <td>{row.answers}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="basis" style={{ marginTop: 12 }}>
              {MARKETING_COPY.sampleFloor} {MEASUREMENT_COPY.underFloor}
            </div>
          </div>
        </div>
      </section>

      {/* 5 · эксперименты */}
      <section className="sec" id="experiments">
        <div className="wrap">
          <SecHead n={5} title="Experiments and estimated contribution">
            {METHOD_COPY.experiments}
          </SecHead>
          <div className="g2">
            <div className="limit">
              <h3>How the estimate is made</h3>
              <p>
                {METHOD_COPY.estimate} Baseline: the {BASELINE_WINDOW_DAYS} days before the work was
                marked done.
              </p>
            </div>
            <div className="limit">
              <h3>Where its confidence comes from</h3>
              <p>{METHOD_COPY.experimentConfidence}</p>
            </div>
            <div className="limit">
              <h3>How wide the band is</h3>
              <p>{MARKETING_COPY.contributionBand}</p>
            </div>
            <div className="limit">
              <h3>What it cannot do</h3>
              <p>{METHOD_COPY.experimentLimits}</p>
            </div>
          </div>
        </div>
      </section>

      {/* 6 · что храним */}
      <section className="sec" id="kept">
        <div className="wrap">
          <SecHead n={6} title="What we keep">
            {METHOD_COPY.kept}
          </SecHead>
          <ul className="rules">
            <li>
              <span>
                <b>Answers.</b> {MARKETING_COPY.answersStored}
              </span>
            </li>
            <li>
              <span>
                <b>Decisions.</b> {METHOD_COPY.decisions}
              </span>
            </li>
            <li>
              <span>
                <b>Publishing.</b> {MARKETING_COPY.limits.nothingPublished}
              </span>
            </li>
          </ul>
        </div>
      </section>

      {/* 7 · чего никогда не утверждаем */}
      <section className="sec" id="never">
        <div className="wrap">
          <SecHead n={7} title="What we never claim">
            Stated here rather than in the footnotes, because you will repeat these lines to your own
            client.
          </SecHead>
          <div className="split">
            <ul className="never x" data-testid="method-never">
              {METHOD_COPY.neverClaim.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <div className="g2" data-testid="method-limits">
              {LIMITS.map((limit) => (
                <div className="limit" key={limit.title}>
                  <h3>{limit.title}</h3>
                  <p>{limit.body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="sec">
        <div className="wrap closing">
          <h2 className="h1">See the method on one of your own clients</h2>
          <div>
            <p className="prose">
              The free audit asks the questions, keeps every answer and shows each figure with the
              answers behind it. Nothing is charged to run it.
            </p>
            <div className="ctas" style={{ marginTop: 22 }}>
              <Link className="btn primary" href="/signup">
                Run a free audit
              </Link>
              <Link className="link" href="/sample-report">
                See an example report →
              </Link>
            </div>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
