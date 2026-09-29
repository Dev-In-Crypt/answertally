import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { MARKETING_COPY, SAMPLE_DELIVERY_REPORT } from "@repo/core";
import { auth } from "@/lib/auth";
import { Faq, MethodLink, SecHead, SrcChip } from "@/components/marketing/bits";
import { MarketingShell } from "@/components/marketing/chrome";
import {
  AUDIENCE,
  checkoutCopy,
  MARKET_NOTE,
  OBJECTIONS,
  PRICING_NOTES,
} from "@/components/marketing/content";
import { getPaymentProvider } from "@/server/payments";
import { PER_CLIENT_MAX, PER_CLIENT_MIN, PLANS, CLIENT, int, usd } from "@/components/marketing/data";
import { EvidenceCard } from "@/components/marketing/evidence-card";
import { ReportPreview } from "@/components/marketing/report-preview";

/**
 * Главная витрины. Залогиненного корень не задерживает: он пришёл работать,
 * а не читать про продукт.
 *
 * Порядок: ответ на вопрос клиента с доказательствами (hero) → деньги
 * агентства → цикл из трёх шагов → что получает клиент → возражения →
 * цены → аудит. Методология вынесена на /method, здесь — строка и ссылки.
 *
 * Отчёт на странице собран из того же примера, что /sample-report, и
 * повторяет настоящий `ReportView`; цены — из `PLAN_LIMITS` (через `PLANS`).
 */

export const metadata: Metadata = {
  title: "Answertally · AI visibility for agencies, with the evidence shown",
  description:
    "Answer your clients’ “are we in ChatGPT?” with sampled AI answers, ranges and confidence levels, ranked work with a reason on every item, and a white-label report the client approves by link.",
};

const WL = MARKETING_COPY.whiteLabel;

export default async function HomePage() {
  const session = await auth.api.getSession({ headers: await headers() });

  if (session) {
    redirect("/dashboard");
  }

  return (
    <MarketingShell>
      <div className="wrap">
        <section className="hero" aria-labelledby="hero-title">
          <div>
            <div className="kicker">AI visibility for agencies</div>
            <h1 className="display" id="hero-title">
              Answer “Are we in ChatGPT?” <em>with numbers that show their work.</em>
            </h1>
            <p className="lead">
              Answertally asks ChatGPT, Perplexity and Grok the questions your client’s buyers ask,
              several times each. {MARKETING_COPY.evidencePromise} Your client gets it as a report in
              your brand.
            </p>
            <div className="ctas">
              <Link className="btn primary" href="/signup" data-testid="landing-cta-audit">
                Run a free audit on one client
              </Link>
              <Link className="btn secondary" href="/sample-report">
                See an example report
              </Link>
            </div>
            <div className="hero-meta">
              <p className="method-line" data-testid="hero-method">
                <span className="label">Method</span>
                <span>{MARKETING_COPY.methodLine}</span>
                <MethodLink />
              </p>
              <div className="chip-row" aria-label="Assistants measured">
                <span className="a-chip">ChatGPT</span>
                <span className="a-chip">Perplexity</span>
                <span className="a-chip">Grok</span>
                <span className="a-chip opt">Claude · per client</span>
              </div>
            </div>
          </div>

          <div className="stage">
            <EvidenceCard />
            <span className="label" style={{ textAlign: "center" }}>
              Your team’s view of one figure. What the client receives is further down.
            </span>
          </div>
        </section>
      </div>

      {/* 1 · деньги агентства */}
      <section className="sec" id="service">
        <div className="wrap">
          <SecHead n={1} title="A new service for clients you already have">
            Your clients already ask what ChatGPT says about them. You have the relationship, the SEO
            team and the reporting habit. What is missing is a way to measure it and something to
            hand over, and that is the part Answertally does, so the service does not start with a
            new hire.
          </SecHead>
          <figure className="market-note">
            <blockquote>{MARKET_NOTE.text}</blockquote>
            <figcaption>
              <a href={MARKET_NOTE.href} rel="noopener noreferrer" target="_blank">
                {MARKET_NOTE.source}
              </a>
            </figcaption>
          </figure>
          <div className="g3" data-testid="landing-money">
            <div className="card pad money">
              <h3 className="h4">Sell it on its own, or fold it in</h3>
              <p className="small">
                Whatever your clients call it, it arrives as visible new work: a baseline, ranked work
                with reasons, and a report they approve. Charge for it as a line item or use it to
                strengthen a retainer you already have.
              </p>
            </div>
            <div className="card pad money">
              <h3 className="h4">Your team does the work, not the spreadsheet</h3>
              <p className="small">
                Answertally does the asking, reading and counting. Each piece of work opens as a brief
                with its objective, the numbers behind it, steps and acceptance criteria, and one view
                across every client shows which ones need attention this week.
              </p>
            </div>
            <div className="card pad money">
              <h3 className="h4">Priced per client, team included</h3>
              <p className="small">
                About {usd(PER_CLIENT_MIN)}–{usd(PER_CLIENT_MAX)} per client a month, depending on the
                plan. No seats and no credits to count.
              </p>
              <Link className="link" href="/pricing#resale">
                Work it out with your own prices →
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* 2 · цикл из трёх шагов */}
      <section className="sec" id="how">
        <div className="wrap">
          <SecHead n={2} title="One loop per client, in three steps">
            Each step feeds the next, and each keeps its evidence attached.
          </SecHead>
          <ol className="g3" data-testid="landing-steps">
            <li className="card step">
              <div className="viz col">
                <SrcChip n={1} domain="reviewhub.example" kind="gap" note="gap" />
                <SrcChip n={2} domain="forum.example" kind="gap" note="gap" />
                <SrcChip n={3} domain="fernpost.example" kind="has" note="client" />
              </div>
              <span className="num">1</span>
              <h3>See where the client is losing</h3>
              <p>
                How often each assistant names your client and its competitors, question by
                question, and which sources are cited in answers that name a competitor but not your
                client.
              </p>
            </li>
            <li className="card step">
              <div className="viz">
                <div className="mini-act">
                  <b>Get covered on reviewhub.example</b>
                  <span>
                    Reason: cited in 18% of answers; Quillstack and Loambox appear there, {CLIENT} does
                    not.
                  </span>
                </div>
              </div>
              <span className="num">2</span>
              <h3>Work through it in order, a reason on every item</h3>
              <p>
                Every opportunity and every action says why it is there. When work is marked done,
                the product compares the topics it touched with the client’s untouched topics: an
                estimate with a confidence level, not attribution.
              </p>
            </li>
            <li className="card step">
              <div className="viz">
                <div className="mini-rep" aria-hidden>
                  <div className="b" />
                  <div className="l" />
                  <div className="t" />
                  <div className="t short" />
                  <div className="t" />
                  <div className="ok" />
                </div>
              </div>
              <span className="num">3</span>
              <h3>Report in your brand, approved by link</h3>
              <p>
                Your logo and colour on a page the client opens without an account. They approve the
                report and the next sprint in it by typing their name, so the plan is agreed in
                writing.
              </p>
            </li>
          </ol>
          <div className="row-between">
            <Link className="link" href="/product">
              See each step in the product →
            </Link>
            <MethodLink />
          </div>
        </div>
      </section>

      {/* 3 · что получает клиент */}
      <section className="sec" id="sample-report">
        <div className="wrap">
          <SecHead n={3} title="What your client receives">
            Agencies do not resell a dashboard. They resell the document in front of their client, so
            this is the real report layout, cut short, from the example quarter.
          </SecHead>
          <div className="split">
            <div className="side">
              <ul className="rules" data-testid="landing-report-rules">
                <li>
                  <span>
                    <b>Your brand.</b> {WL.page}
                  </span>
                </li>
                <li>
                  <span>
                    <b>A link, no login.</b> {WL.link}
                  </span>
                </li>
                <li>
                  <span>
                    <b>Approved in writing.</b> {WL.approve}
                  </span>
                </li>
                <li>
                  <span>
                    <b>The caveats travel with it.</b> Every figure is called an estimate, and every
                    report ends with a “How to read this” section.
                  </span>
                </li>
                <li>
                  <span>
                    <b>PDF and email.</b> {WL.pdf} {WL.email}
                  </span>
                </li>
              </ul>
              <Link className="btn secondary" href="/sample-report" style={{ marginTop: 26 }}>
                Open the full example
              </Link>
            </div>
            <div className="wl-stage">
              <ReportPreview
                payload={SAMPLE_DELIVERY_REPORT}
                variant="delivery"
                testId="landing-report"
                ariaLabel="Example white-label quarterly report, abridged"
                hint="Preview in an agency’s brand"
                approve
              />
            </div>
          </div>
        </div>
      </section>

      {/* 4 · возражения */}
      <section className="sec" id="questions">
        <div className="wrap">
          <SecHead n={4} title="What agencies ask before they buy">
            In the words we hear most, with straight answers.
          </SecHead>
          <Faq items={OBJECTIONS} testId="landing-objections" />
          <p style={{ marginTop: 22 }}>
            <MethodLink>Read the full method, and what we never claim →</MethodLink>
          </p>
          <div className="aud">
            <div>
              <h3>Built for</h3>
              <ul>
                {AUDIENCE.forYou.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div className="no">
              <h3>Not built for</h3>
              <ul>
                {AUDIENCE.notForYou.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* 5 · тарифы коротко */}
      <section className="sec" id="pricing">
        <div className="wrap">
          <SecHead n={5} title="Priced per client, your team included">
            {PRICING_NOTES.unit} {PRICING_NOTES.included}
          </SecHead>
          <ul className="g3" data-testid="pricing-plans">
            {PLANS.map((plan) => (
              <li key={plan.id} className="card pad plan-mini">
                <div>
                  <div className="h4">{plan.name}</div>
                  <div className="small muted">{plan.audience}</div>
                </div>
                <div className="price">
                  <b data-testid={`plan-price-${plan.id}`}>{usd(plan.priceUsd)}</b>
                  <span>/ month</span>
                </div>
                <dl className="kv">
                  <div>
                    <dt>Client accounts</dt>
                    <dd>up to {plan.clientLimit}</dd>
                  </div>
                  <div>
                    <dt>Per client, plan full</dt>
                    <dd>≈ {usd(plan.perClientUsd)}</dd>
                  </div>
                  <div>
                    <dt>AI checks / month</dt>
                    <dd>{int(plan.aiCheckAllowance)}</dd>
                  </div>
                </dl>
              </li>
            ))}
          </ul>
          <div className="row-between">
            <span className="label">{checkoutCopy(getPaymentProvider().configured).note}</span>
            <Link className="link" href="/pricing">
              Full pricing and what an AI check is →
            </Link>
          </div>
        </div>
      </section>

      <section className="sec">
        <div className="wrap closing">
          <h2 className="h1">Start with one client, for free</h2>
          <div>
            <p className="prose">
              Create a workspace, add one brand and run the audit. It takes longer than a page
              load, because every question is asked several times on each assistant. You end with a
              diagnosis, ranked work and a report in your brand to take into the next client meeting.
            </p>
            <div className="ctas" style={{ marginTop: 22 }}>
              <Link className="btn primary" href="/signup">
                Run a free audit
              </Link>
              <Link className="link" href="/free-audit">
                What the audit produces →
              </Link>
            </div>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
