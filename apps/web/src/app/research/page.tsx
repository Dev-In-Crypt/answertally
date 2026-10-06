import type { Metadata } from "next";
import Link from "next/link";
import { MARKETING_COPY, METHOD_COPY, MIN_SAMPLES_PER_CELL } from "@repo/core";
import { MethodLink, SecHead } from "@/components/marketing/bits";
import { MarketingShell } from "@/components/marketing/chrome";
import { SPARKTORO_STUDY } from "@/components/marketing/content";
import { HAS_SALES_CONTACT, SalesCta } from "../partners/sales-cta";

/**
 * Страница собственного исследования, которого ещё нет.
 *
 * Единственный способ написать такую страницу честно — не писать выводов.
 * Здесь нет ни одной цифры о рынке, ни одной даты публикации и ни одного
 * «мы обнаружили»: есть вопрос, метод, список того, что будет опубликовано,
 * и то, чего мы не станем утверждать даже с данными на руках.
 *
 * Дата отсутствует намеренно. Срок зависит от того, сколько ответов наберётся,
 * а объявленная и сорванная дата стоит дороже, чем её отсутствие.
 */

export const metadata: Metadata = {
  alternates: { canonical: "/research" },
  title: "AI Answer Research: Method and Findings · Answertally",
  description:
    "Our first study of how AI assistants answer buyer questions is under way. The method and what we will publish; no findings yet, and none invented.",
};

/** Что будет опубликовано вместе с выводами. Список — и есть обещание. */
const WILL_PUBLISH = [
  {
    title: "The questions",
    body: "The full list of prompts, verbatim, so anyone can ask them again rather than take our word for what was asked.",
  },
  {
    title: "The counts",
    body: "How many answers were collected per question per assistant, per week — not only the shares worked out from them.",
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
              Our first study is being run. <em>There are no findings yet.</em>
            </h1>
            <p className="lead">
              We would rather have this page say nothing than say something we have not measured.
              So instead of results, here is the question we are asking, how we are asking it,
              what we will publish alongside the answer, and what we will not claim even once the
              data is in.
            </p>
            <div className="ctas" style={{ marginTop: 28 }}>
              <MethodLink>Read the method we use →</MethodLink>
            </div>
          </div>
          <aside className="card method" aria-label="Status" data-testid="research-status">
            <div className="cap">Status</div>
            <dl>
              <div>
                <dt>Findings published</dt>
                <dd>none</dd>
              </div>
              <div>
                <dt>Study</dt>
                <dd>being run</dd>
              </div>
              <div>
                <dt>Publication date</dt>
                <dd>not set</dd>
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
              No date appears on this page because we would be inventing it. It publishes when
              there are enough answers behind it to be worth reading.
            </div>
          </aside>
        </section>
      </div>

      {/* 1 · вопрос */}
      <section className="sec" id="question">
        <div className="wrap">
          <SecHead n={1} title="The question we are asking">
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
                  share stops moving around — which is the number that decides what the product
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
                Somebody else&rsquo;s work, linked because it exists and ours does not yet.
              </figcaption>
            </figure>
          </div>
        </div>
      </section>

      {/* 2 · метод */}
      <section className="sec" id="method">
        <div className="wrap">
          <SecHead n={2} title="How it is being run">
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
          <SecHead n={3} title="What gets published with it">
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
          <SecHead n={4} title="What we will not claim, even with the data">
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
          <h2 className="h1">Until then, measure your own client</h2>
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
