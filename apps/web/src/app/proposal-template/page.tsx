import type { Metadata } from "next";
import Link from "next/link";
import { MARKETING_COPY, METHOD_COPY, REPORT_COPY } from "@repo/core";
import { MarketingShell } from "@/components/marketing/chrome";
import { CLIENT } from "@/components/marketing/data";
import { SalesCta } from "../partners/sales-cta";
import { PrintButton } from "./print-button";
import "./proposal.css";

/**
 * Шаблон предложения, который агентство приспосабливает под своего клиента.
 *
 * Два вида блоков, и различие между ними — главное в странице:
 *   • «Example — replace» — выдуманные значения. Клиент, конкуренты и домены
 *     в зоне `.example` — те же, что на остальной витрине, чтобы никто не
 *     принял их за настоящий кейс.
 *   • «Keep this as written» — то, чем измерение является на самом деле.
 *     Эти куски берутся константами из `@repo/core`: если формулировка метода
 *     изменится, шаблон изменится вместе с ней, а не останется врать на бумаге.
 *
 * Страница печатается на A4 (`proposal.css`): агентство уносит её в свой
 * документ либо печатает как есть. Ни один блок не обещает позицию или
 * результат — это не осторожность, это единственное, что тут можно утверждать.
 */

export const metadata: Metadata = {
  alternates: { canonical: "/proposal-template" },
  title: "Proposal template · Answertally",
  description:
    "An AI-visibility proposal an agency can adapt for its client: situation, what is measured, the work, reporting, cost and what is not promised.",
};

/** Выдуманный пример измерения. Совпадает с примером отчёта на витрине. */
const EXAMPLE_SCOPE = [
  { item: "Buyer questions tracked", value: "24" },
  { item: "Assistants asked", value: "ChatGPT, Perplexity, Grok" },
  { item: "Answers per question per assistant, per run", value: "3" },
  { item: "How often", value: "every two weeks" },
  { item: "Competitors compared", value: "4" },
  { item: "First report", value: "after the second run" },
];

const EXAMPLE_WORK = [
  {
    item: "Get the client listed and described correctly on the review sites assistants cite",
    value: "~12h",
  },
  { item: "Write the comparison pages the cited sources keep sending buyers to", value: "~16h" },
  { item: "Fix the product pages that answer the questions buyers actually ask", value: "~10h" },
  { item: "Monthly reading of the measurements and the next sprint", value: "~4h / month" },
];

const EXAMPLE_COST = [
  { item: "Set-up: questions, competitors, first audit", value: "$2,400 once" },
  { item: "Monthly retainer: measurement, diagnosis, the work above, reporting", value: "$3,200" },
  { item: "Minimum term before the first honest read", value: "3 months" },
];

export default function ProposalTemplatePage() {
  return (
    <MarketingShell>
      <div className="wrap">
        <section className="p-hero pt-screen">
          <div>
            <div className="kicker page-kicker">Template</div>
            <h1 className="display">
              An AI-visibility proposal <em>you can put your name on.</em>
            </h1>
            <p className="lead">
              The structure of a proposal for the client you want to sell this to: what the
              situation is, what gets measured, what you will do, how you report, what it costs
              and what you are not promising. Every number below is invented and marked as an
              example: replace them with your own.
            </p>
          </div>
          <aside className="card method" aria-label="How to use this template">
            <div className="cap">How to use it</div>
            <dl>
              <div>
                <dt>Blocks marked Example</dt>
                <dd>replace</dd>
              </div>
              <div>
                <dt>Blocks marked Keep</dt>
                <dd>leave as written</dd>
              </div>
              <div>
                <dt>Prints on</dt>
                <dd>A4 or Letter</dd>
              </div>
              <div>
                <dt>Is it a contract</dt>
                <dd>no</dd>
              </div>
            </dl>
            <div className="basis">
              This is a writing aid, not legal or commercial advice. Check it against your own
              terms before it goes to a client.
            </div>
          </aside>
        </section>
      </div>

      <section className="sec">
        <div className="wrap">
          <div className="pt-bar pt-screen">
            <p className="small">
              Print it, or copy the structure into your own document. The page prints on
              A4 or US Letter and drops this site&rsquo;s header and footer when printed.
            </p>
            <PrintButton />
          </div>

          <div className="proposal" data-testid="proposal-template">
            <div className="pt-doc">
              <header className="pt-head">
                <b>AI visibility proposal</b>
                <span className="label">[Your agency] for [Client] · [Date]</span>
              </header>

              {/* 1 · ситуация */}
              <section className="pt-sec" id="situation">
                <h2>
                  <span className="n" aria-hidden>
                    1
                  </span>
                  The situation
                </h2>
                <p className="pt-guide">
                  One short paragraph in the client&rsquo;s own words: why this came up now. Use
                  something they said to you, not a market statistic you cannot source. If you
                  only have a suspicion, say it is a suspicion. The audit is what turns it into
                  something readable.
                </p>
                <div className="pt-ex">
                  <span className="pt-tag">Example, replace</span>
                  <p>
                    {CLIENT} sells project software to small design studios. In the last two
                    quarters three inbound leads mentioned that they had asked an AI assistant
                    for options before booking a demo. Nobody at {CLIENT} knows what those
                    answers say, whether {CLIENT} is named in them, or which sources the
                    assistants are reading to produce them.
                  </p>
                </div>
              </section>

              {/* 2 · что измеряем */}
              <section className="pt-sec" id="measure">
                <h2>
                  <span className="n" aria-hidden>
                    2
                  </span>
                  What we measure
                </h2>
                <p className="pt-guide">
                  Two parts. The scope is yours to set: how many questions, which assistants,
                  which competitors. The definition underneath it is not: keep it as written, so
                  the client reads the same description of the measurement that the reports will
                  use.
                </p>
                <div className="pt-fixed">
                  <span className="pt-tag">Keep this as written</span>
                  <p>{METHOD_COPY.instead}</p>
                  <p>
                    {MARKETING_COPY.sampleFloor} {METHOD_COPY.interval} {METHOD_COPY.api}
                  </p>
                  <p>{MARKETING_COPY.notMeasuredSurfaces}</p>
                </div>
                <div className="pt-ex">
                  <span className="pt-tag">Example, replace</span>
                  <table className="pt-table">
                    <thead>
                      <tr>
                        <th scope="col">Scope</th>
                        <th scope="col">Proposed</th>
                      </tr>
                    </thead>
                    <tbody>
                      {EXAMPLE_SCOPE.map((row) => (
                        <tr key={row.item}>
                          <td>{row.item}</td>
                          <td>{row.value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              {/* 3 · что будем делать */}
              <section className="pt-sec" id="work">
                <h2>
                  <span className="n" aria-hidden>
                    3
                  </span>
                  What we will do
                </h2>
                <p className="pt-guide">
                  Before the first audit you do not know which pieces of work matter, so list the
                  kinds of work and say plainly that the order comes from the measurement. After
                  the audit, replace this with the ranked list the diagnosis produced, each item
                  with its reason. Effort is your estimate for your own team; write it as one.
                </p>
                <div className="pt-ex">
                  <span className="pt-tag">Example, replace</span>
                  <table className="pt-table">
                    <thead>
                      <tr>
                        <th scope="col">Work</th>
                        <th scope="col">Effort</th>
                      </tr>
                    </thead>
                    <tbody>
                      {EXAMPLE_WORK.map((row) => (
                        <tr key={row.item}>
                          <td>{row.item}</td>
                          <td>{row.value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="pt-fixed">
                  <span className="pt-tag">Keep this as written</span>
                  <p>{REPORT_COPY.opportunityBasis}</p>
                  <p>{MARKETING_COPY.limits.nothingPublished}</p>
                </div>
              </section>

              {/* 4 · как отчитываемся */}
              <section className="pt-sec" id="report">
                <h2>
                  <span className="n" aria-hidden>
                    4
                  </span>
                  How we report
                </h2>
                <p className="pt-guide">
                  Say what arrives, how often, and what the client is asked to do with it. The
                  approval step is worth naming: it is the moment the client agrees to the next
                  sprint, and it is the reason the report is a decision document rather than a
                  dashboard nobody opens.
                </p>
                <div className="pt-ex">
                  <span className="pt-tag">Example, replace</span>
                  <ul>
                    <li>
                      A report each month, as a link in our brand, plus a PDF if you prefer to
                      forward a document.
                    </li>
                    <li>
                      It shows where you stand now against the start of the period, per
                      assistant, each figure with its range and how many answers sit behind it.
                    </li>
                    <li>
                      It lists what we did, what followed, and what we propose to do next.
                    </li>
                    <li>
                      You approve the next sprint on the report page by typing your name. Nothing
                      starts before that.
                    </li>
                  </ul>
                </div>
                <div className="pt-fixed">
                  <span className="pt-tag">Keep this as written</span>
                  <p>{MARKETING_COPY.experimentMethod}</p>
                </div>
              </section>

              {/* 5 · сколько стоит */}
              <section className="pt-sec" id="cost">
                <h2>
                  <span className="n" aria-hidden>
                    5
                  </span>
                  What it costs
                </h2>
                <p className="pt-guide">
                  Your price, your terms. Two things are worth stating next to the number: what
                  the retainer buys each month, and the shortest period after which the
                  measurements say anything at all. Quoting a one-month term for something that
                  moves over a quarter sets the client up to be disappointed.
                </p>
                <div className="pt-ex">
                  <span className="pt-tag">Example, replace</span>
                  <table className="pt-table">
                    <thead>
                      <tr>
                        <th scope="col">Item</th>
                        <th scope="col">Amount</th>
                      </tr>
                    </thead>
                    <tbody>
                      {EXAMPLE_COST.map((row) => (
                        <tr key={row.item}>
                          <td>{row.item}</td>
                          <td>{row.value}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <p className="pt-note">{REPORT_COPY.scopeEstimate}</p>
                </div>
                <div className="pt-fixed">
                  <span className="pt-tag">Keep this as written</span>
                  <p>{MARKETING_COPY.limits.quarter}</p>
                </div>
              </section>

              {/* 6 · чего не обещаем */}
              <section className="pt-sec" id="never">
                <h2>
                  <span className="n" aria-hidden>
                    6
                  </span>
                  What we do not promise
                </h2>
                <p className="pt-guide">
                  Keep this section. It costs you nothing that was ever deliverable, and it is
                  the part that makes the rest of the document believable, particularly to a
                  client who has been sold an AI-search package before.
                </p>
                <div className="pt-fixed">
                  <span className="pt-tag">Keep this as written</span>
                  <ul className="never x" data-testid="proposal-never">
                    {METHOD_COPY.neverClaim.map((item) => (
                      <li key={item}>{item}</li>
                    ))}
                  </ul>
                  <p>{MARKETING_COPY.limits.attribution}</p>
                  <p>{MARKETING_COPY.limits.revenue}</p>
                </div>
              </section>

              {/* 7 · следующий шаг */}
              <section className="pt-sec" id="next">
                <h2>
                  <span className="n" aria-hidden>
                    7
                  </span>
                  The next step
                </h2>
                <p className="pt-guide">
                  One step, with a name against it and a date. If you have run the free audit
                  already, the next step is a conversation about what it found; if you have not,
                  the next step is running it.
                </p>
                <div className="pt-ex">
                  <span className="pt-tag">Example, replace</span>
                  <ul>
                    <li>
                      [Your name] runs the audit on {CLIENT} and the four competitors, at no cost and with
                      nothing published.
                    </li>
                    <li>
                      We walk through what the assistants answered and which sources they cited.
                    </li>
                    <li>
                      If it is worth doing, we start on [date] with the scope in section 3.
                    </li>
                  </ul>
                </div>
              </section>

              <p className="pt-note">
                Template. Example agency, client, competitors and figures are invented.
              </p>
            </div>
          </div>
        </div>
      </section>

      <section className="sec pt-screen">
        <div className="wrap closing">
          <h2 className="h1">Fill it in with a real measurement</h2>
          <div>
            <p className="prose">
              Section 3 is guesswork until an audit has run. The audit costs nothing, produces
              the ranked work with a reason on each item, and gives you the report to attach to
              this proposal.
            </p>
            <div className="ctas" style={{ marginTop: 22 }}>
              <Link className="btn primary" href="/signup">
                Run a free audit
              </Link>
              <Link className="link" href="/partners">
                How agencies sell this →
              </Link>
              <SalesCta fallbackLabel="See a sample report" fallbackHref="/sample-report" />
            </div>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
