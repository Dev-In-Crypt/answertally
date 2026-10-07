import type { Metadata } from "next";
import Link from "next/link";
import { MARKETING_COPY, METHOD_COPY, MIN_SAMPLES_PER_CELL, wilsonInterval } from "@repo/core";
import { MethodLink, SecHead } from "@/components/marketing/bits";
import { MarketingShell } from "@/components/marketing/chrome";
import { SPARKTORO_STUDY } from "@/components/marketing/content";
import { HAS_SALES_CONTACT, SalesCta } from "../partners/sales-cta";
import { FIELD_NOTES_1 } from "./field-notes";

/**
 * Страница собственного исследования: полевые заметки №1 (5 брендов, 458
 * ответов, 06–07.10.2026) плюс метод полного исследования, которое идёт.
 *
 * Цифры таблицы считаются из `field-notes.ts` (данные замера), выводы в
 * тексте — из того же замера; пересчитать их при новых данных. Даты полного
 * исследования нет намеренно: объявленная и сорванная дата стоит дороже.
 */

export const metadata: Metadata = {
  alternates: { canonical: "/research" },
  title: "AI Answer Research: How Often Assistants Name Smaller Brands · Answertally",
  description:
    "Field notes from 458 ChatGPT and Perplexity answers about five brands: how often each was named, with ranges, how stable that was, and what the assistants cited.",
};

const pct = (k: number, n = 1) => `${Math.round((k / n) * 100)}%`;

const ASSISTANT_NAME: Record<string, string> = { chatgpt: "ChatGPT", perplexity: "Perplexity" };

const TOTAL_ANSWERS = FIELD_NOTES_1.reduce(
  (sum, b) => sum + b.control.answers + b.cells.reduce((s, c) => s + c.answers, 0),
  0,
);

/**
 * Выводы полевых заметок №1. Повторы, согласие ассистентов и цитаты
 * посчитаны по сырым ответам того же замера; в таблицу они не вынесены.
 */
const FINDINGS = [
  {
    title: "Named in half the answers or more",
    body: "On questions built around what each brand does differently, every one of the five was named in 51% to 87% of answers. Broad “best in category” questions are where small brands disappear, so each set kept only a few.",
  },
  {
    title: "Steadier than its reputation",
    body: "Asked the same question three times on the same assistant, whether the brand was named came out the same all three times in 124 of 136 cases (91%). Which brands make a list changes from run to run; whether yours is on it changes much less.",
  },
  {
    title: "ChatGPT reads the brand’s own site, Perplexity reads everyone else",
    body: "ChatGPT cited the brand’s own site in 25 Brooklinen answers and 41 Plausible answers; Perplexity did so in 3 and 7, leaning on review sites and roundups instead. Owned pages and third-party coverage are two different jobs.",
  },
  {
    title: "Buying questions are the weak spot",
    body: "For three of the five brands, questions asked at the point of purchase named them least: Kubera in 20% of them against 90% for comparison questions, Graza in 40%. That gap is where an agency has the most to work on.",
  },
  {
    title: "The control questions stayed quiet",
    body: "Questions about a neighbouring category each brand does not sell named it in 1 of 48 answers. The counting finds the brand where it belongs, not everywhere.",
  },
  {
    title: "The assistants mostly agree, not always",
    body: "Where both were asked, ChatGPT and Perplexity agreed on whether a brand was named for 31 of 38 questions. The other 7 are a reason to report each assistant separately rather than blend them.",
  },
];

/** Что будет опубликовано вместе с выводами. Список — и есть обещание. */
const WILL_PUBLISH = [
  {
    title: "The questions",
    body: "The full list of prompts, verbatim, so anyone can ask them again rather than take our word for what was asked.",
  },
  {
    title: "The counts",
    body: "How many answers were collected per question per assistant, per week, not only the shares worked out from them.",
  },
  {
    title: "The ranges",
    body: "Every share with the interval around it and the number of answers behind it, on the same basis the product uses.",
  },
  {
    title: "The model versions and dates",
    body: "Which model answered and when. An assistant's behaviour changes between versions, so a figure without a version is not repeatable.",
  },
  {
    title: "What went wrong",
    body: "Questions that had to be dropped, runs that failed, anything that would change how the numbers should be read.",
  },
  {
    title: "What we did not measure",
    body: MARKETING_COPY.notMeasuredSurfaces,
  },
];

/** Пределы будущего исследования — названы до того, как появились данные. */
const LIMITS = [
  {
    title: "Not a market survey",
    body: "It measures how assistants answer a fixed set of questions. It says nothing about how many people ask them, or what any of it is worth in revenue.",
  },
  {
    title: "A sample, not a census",
    body: "A finite number of questions on a finite number of assistants, over a finite period. Every figure will carry the range that follows from that.",
  },
  {
    title: "Nothing about your client",
    body: "General findings do not transfer to one brand. A study is a reason to measure your own client, not a substitute for measuring them.",
  },
  {
    title: "No claim about why",
    body: "If something moves during the study we will show what moved and over which weeks. Attributing it to a reason is a different study than this one.",
  },
];

export default function ResearchPage() {
  return (
    <MarketingShell>
      <div className="wrap">
        <section className="p-hero">
          <div>
            <div className="kicker page-kicker">Research</div>
            <h1 className="display">
              Smaller brands get named more than you think. <em>On the right questions.</em>
            </h1>
            <p className="lead">
              Field notes #1: {TOTAL_ANSWERS} answers from ChatGPT and Perplexity about five brands,
              asked the way their buyers ask. Every figure below comes with its range, and the
              questions are published word for word so anyone can ask them again.
            </p>
            <div className="ctas" style={{ marginTop: 28 }}>
              <MethodLink>Read the method we use →</MethodLink>
            </div>
          </div>
          <aside className="card method" aria-label="Status" data-testid="research-status">
            <div className="cap">Status</div>
            <dl>
              <div>
                <dt>Field notes #1</dt>
                <dd>published 7 Oct 2026</dd>
              </div>
              <div>
                <dt>Answers collected</dt>
                <dd>{TOTAL_ANSWERS}</dd>
              </div>
              <div>
                <dt>Brands</dt>
                <dd>{FIELD_NOTES_1.length}</dd>
              </div>
              <div>
                <dt>Full study</dt>
                <dd>being run</dd>
              </div>
              <div>
                <dt>Answers per question per assistant</dt>
                <dd>&ge; {MIN_SAMPLES_PER_CELL}</dd>
              </div>
              <div>
                <dt>Raw answers released</dt>
                <dd>yes</dd>
              </div>
            </dl>
            <div className="basis">
              The full study has no date yet because we would be inventing it. It publishes when
              there are enough answers behind it to be worth reading.
            </div>
          </aside>
        </section>
      </div>

      {/* 1 · полевые заметки */}
      <section className="sec" id="field-notes">
        <div className="wrap">
          <SecHead n={1} title="Field notes #1: what we found">
            Five brands, picked because each is smaller than the leaders of its category. Questions
            drafted by the product from each brand’s homepage, each asked three times per assistant,
            on 6 and 7 October 2026.
          </SecHead>
          <ul className="incl" data-testid="research-findings">
            {FINDINGS.map((item, i) => (
              <li key={item.title}>
                <span className="num" aria-hidden>
                  {i + 1}
                </span>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </li>
            ))}
          </ul>
          <div className="cmp-wrap" style={{ marginTop: 28 }}>
            <table className="cmp" data-testid="research-table">
              <thead>
                <tr>
                  <th scope="col">Brand</th>
                  <th scope="col">Category</th>
                  <th scope="col">Assistant</th>
                  <th scope="col">Named in</th>
                  <th scope="col">Range (95%)</th>
                  <th scope="col">Buying questions, all assistants</th>
                </tr>
              </thead>
              <tbody>
                {FIELD_NOTES_1.flatMap((brand) =>
                  brand.cells.map((cell, i) => {
                    const range = wilsonInterval(cell.named, cell.answers);
                    return (
                      <tr key={brand.brand + cell.assistant}>
                        <th scope="row">{i === 0 ? brand.brand : ""}</th>
                        <td>{i === 0 ? brand.category : ""}</td>
                        <td>{ASSISTANT_NAME[cell.assistant]}</td>
                        <td>
                          {pct(cell.named, cell.answers)} ({cell.named} of {cell.answers})
                        </td>
                        <td>{range ? `${pct(range.low)}–${pct(range.high)}` : "–"}</td>
                        <td>
                          {i === 0
                            ? `${pct(brand.purchase.named, brand.purchase.answers)} (${brand.purchase.named} of ${brand.purchase.answers})`
                            : ""}
                        </td>
                      </tr>
                    );
                  }),
                )}
              </tbody>
            </table>
          </div>
          <p className="small muted" style={{ marginTop: 12 }}>
            Shares count answers to the brand’s own questions; control questions are left out here
            and reported in finding 5. Plausible ran 17 of its 24 questions before the run reached
            its budget, and three brands were measured on Perplexity only. Five brands in one week
            are field notes, not a market study: read the ranges before the shares.
          </p>
          <div className="g2" style={{ marginTop: 24 }}>
            {FIELD_NOTES_1.map((brand) => (
              <details className="limit" key={brand.brand}>
                <summary>
                  <b>{brand.brand}</b>: the {brand.questions.length} questions, verbatim
                </summary>
                <ol className="small" style={{ marginTop: 10, paddingLeft: 18, listStyle: "decimal" }}>
                  {brand.questions.map((q) => (
                    <li key={q}>{q}</li>
                  ))}
                </ol>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* 2 · вопрос полного исследования */}
      <section className="sec" id="question">
        <div className="wrap">
          <SecHead n={2} title="What the full study asks">
            Narrow on purpose. A study that tries to describe &ldquo;AI search&rdquo; as a whole
            ends up describing nothing that can be checked.
          </SecHead>
          <div className="split even">
            <ul className="rules">
              <li>
                <span>
                  <b>How much do answers differ between runs?</b> Ask the same buyer question
                  repeatedly, on the same assistant, in the same week, and count how much the set
                  of brands named changes.
                </span>
              </li>
              <li>
                <span>
                  <b>How much do they differ between assistants?</b> The same question on each
                  assistant we measure, compared side by side rather than blended.
                </span>
              </li>
              <li>
                <span>
                  <b>What do they cite?</b> Which kinds of source turn up in answers to
                  commercial questions, and how often the same domains recur.
                </span>
              </li>
              <li>
                <span>
                  <b>How many answers does it take?</b> How large a sample has to be before a
                  share stops moving around. That is the number that decides what the product
                  is allowed to show.
                </span>
              </li>
            </ul>
            <figure className="market-note" style={{ margin: 0 }}>
              <blockquote>{METHOD_COPY.sparkToro}</blockquote>
              <figcaption>
                <a href={SPARKTORO_STUDY.href} rel="noopener noreferrer" target="_blank">
                  {SPARKTORO_STUDY.label}
                </a>
                <br />
                Somebody else&rsquo;s work, on which brands make a list. Our field notes measure
                something narrower, whether a brand is named at all, and found that far steadier.
              </figcaption>
            </figure>
          </div>
        </div>
      </section>

      {/* 2 · метод */}
      <section className="sec" id="method">
        <div className="wrap">
          <SecHead n={3} title="How the full study is run">
            The same way the product measures a client, which is the point: if the method is not
            good enough for a study, it is not good enough to bill an agency for.
          </SecHead>
          <div className="g2">
            <div className="limit">
              <h3>Sampling</h3>
              <p>{METHOD_COPY.samples}</p>
            </div>
            <div className="limit">
              <h3>Through the API</h3>
              <p>{METHOD_COPY.api}</p>
            </div>
            <div className="limit">
              <h3>Windows</h3>
              <p>{METHOD_COPY.windows}</p>
            </div>
            <div className="limit">
              <h3>What is kept</h3>
              <p>{METHOD_COPY.kept}</p>
            </div>
          </div>
          <div className="note" style={{ marginTop: 20 }}>
            The questions and the assistant list are fixed before the runs start, and published
            with the results whichever way they come out. A study whose scope is decided after
            looking at the data is not a study.
          </div>
        </div>
      </section>

      {/* 3 · что опубликуем */}
      <section className="sec" id="publish">
        <div className="wrap">
          <SecHead n={4} title="What gets published with it">
            A number on its own cannot be checked. These go out with it, or it does not go out.
          </SecHead>
          <ul className="incl" data-testid="research-publish">
            {WILL_PUBLISH.map((item, i) => (
              <li key={item.title}>
                <span className="num" aria-hidden>
                  {i + 1}
                </span>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* 4 · чего не будем утверждать */}
      <section className="sec" id="never">
        <div className="wrap">
          <SecHead n={5} title="What we will not claim, even with the data">
            Said now, while there are no results to be tempted by.
          </SecHead>
          <div className="split">
            <ul className="never x" data-testid="research-never">
              {METHOD_COPY.neverClaim.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <div className="g2">
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
          <h2 className="h1">Now measure your own client</h2>
          <div>
            <p className="prose">
              A general study would tell you how assistants behave. An audit tells you what they
              say about the client whose retainer is on the line, which is the only figure that
              settles an argument with that client.
            </p>
            <div className="ctas" style={{ marginTop: 22 }}>
              <Link className="btn primary" href="/signup">
                Run a free audit
              </Link>
              <Link className="link" href="/method">
                How we measure →
              </Link>
              {HAS_SALES_CONTACT && (
                <SalesCta fallbackLabel="Start with the free audit" fallbackHref="/free-audit" />
              )}
            </div>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
