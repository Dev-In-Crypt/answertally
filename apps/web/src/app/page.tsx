import type { Metadata } from "next";
import Link from "next/link";
import { GOOGLE_SURFACES_PLAIN, MARKETING_COPY, METHOD_COPY, SAMPLE_DELIVERY_REPORT } from "@repo/core";
import { CtaNote, Faq, MethodLink, SecHead, SrcChip } from "@/components/marketing/bits";
import { MarketingShell } from "@/components/marketing/chrome";
import { JsonLd } from "@/components/marketing/json-ld";
import { SITE_URL, SUPPORT_EMAIL } from "@/config/site";
import {
  AUDIENCE,
  BUYER_NOTE,
  checkoutCopy,
  MARKET_NOTE,
  OBJECTIONS,
  PRICING_NOTES,
} from "@/components/marketing/content";
import { getPaymentProvider } from "@/server/payments";
import { unstable_cache } from "next/cache";
import { getMeasuredTotals } from "@repo/db";
import { db } from "@/server/db";
import { FIELD_NOTES_1 } from "./research/field-notes";
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
  alternates: { canonical: "/" },
  title: "AI Visibility Reporting for Agencies · Answertally",
  description:
    "Answer “are we in ChatGPT?” with sampled AI answers, ranges and confidence levels, ranked work with reasons, and a white-label report for your client.",
};

const WL = MARKETING_COPY.whiteLabel;

/** Полоса доверия: только то, что записано в юридических страницах. */
const TRUST = [
  { label: "Hosted in the EU (Germany)", href: "/legal/subprocessors" },
  { label: "Data processing terms for agencies", href: "/legal/dpa" },
  { label: "Published sub-processors", href: "/legal/subprocessors" },
  { label: "No model training on your data", href: "/legal/privacy" },
] as const;

/** Цепочка от ответа ИИ до выручки: что меряем мы, что — аналитика клиента. */
const CHAIN = [
  { label: "AI visibility", note: "how often assistants name the client", ours: true },
  { label: "Cited sources", note: "the pages those answers lean on", ours: true },
  { label: "Work done", note: "ranked actions, and what followed them", ours: true },
  { label: "AI referral traffic", note: "visits from assistants, in their analytics" },
  { label: "Leads and revenue", note: "in their CRM" },
];

/** Ответы полевых заметок №1: собраны кодом продукта, но вне базы (скриптом). */
const RESEARCH_ANSWERS = FIELD_NOTES_1.reduce(
  (sum, b) => sum + b.control.answers + b.cells.reduce((s, c) => s + c.answers, 0),
  0,
);

/**
 * Счётчик витрины — настоящие числа из базы плюс ответы исследования, раз в
 * час. Не завышается: покупатель-агентство само в этом разбирается, и одна
 * пойманная подтасовка стоит дороже маленькой цифры. База недоступна —
 * полоса просто не показывается.
 */
const measuredTotals = unstable_cache(
  async () => {
    try {
      return await getMeasuredTotals(db);
    } catch {
      return null;
    }
  },
  ["measured-totals"],
  { revalidate: 3600 },
);

export default async function HomePage() {
  const totals = await measuredTotals();
  return (
    <MarketingShell>
      <JsonLd
        data={{
          "@context": "https://schema.org",
          "@graph": [
            {
              "@type": "Organization",
              "@id": `${SITE_URL}/#organization`,
              name: "Answertally",
              url: SITE_URL,
              logo: `${SITE_URL}/icon.svg`,
              contactPoint: {
                "@type": "ContactPoint",
                contactType: "customer support",
                email: SUPPORT_EMAIL,
              },
            },
            {
              "@type": "SoftwareApplication",
              name: "Answertally",
              url: SITE_URL,
              applicationCategory: "BusinessApplication",
              operatingSystem: "Web",
              description:
                "AI visibility measurement for agencies: sampled answers from ChatGPT, Perplexity, Google AI Overviews and AI Mode, Grok and Claude, ranked work with a reason on every item, and white-label client reports.",
              publisher: { "@id": `${SITE_URL}/#organization` },
              offers: PLANS.map((plan) => ({
                "@type": "Offer",
                name: plan.name,
                price: String(plan.priceUsd),
                priceCurrency: "USD",
                description: `${plan.name}: up to ${plan.clientLimit} client accounts, billed monthly`,
              })),
            },
          ],
        }}
      />
      <div className="wrap">
        <section className="hero" aria-labelledby="hero-title">
          <div>
            <div className="kicker">AI visibility for agencies</div>
            <h1 className="display" id="hero-title">
              Buyers now ask ChatGPT what to buy. <em>Show your clients whether it names them.</em>
            </h1>
            <p className="lead">
              Answer “Are we in ChatGPT?” with numbers that show their work. Answertally asks
              ChatGPT, Perplexity and Google’s AI answers the questions your client’s buyers ask,
              several times each.{" "}
              {MARKETING_COPY.evidencePromise} <b>Your client sees your brand, not ours.</b>
            </p>
            <div className="ctas">
              <Link className="btn primary" href="/signup" data-testid="landing-cta-audit">
                Run a free audit
              </Link>
              <Link className="btn secondary" href="/sample-report">
                See an example report
              </Link>
            </div>
            <CtaNote />
            <p className="small">
              <Link className="link" href="/free-audit#questions">
                Or see which questions we would track for a client, no account needed →
              </Link>
            </p>
            <div className="hero-meta">
              <p className="method-line" data-testid="hero-method">
                <span className="label">Method</span>
                <span>{MARKETING_COPY.methodLine}</span>
                <MethodLink />
              </p>
              <div className="chip-row" aria-label="Assistants measured">
                <span className="a-chip">ChatGPT</span>
                <span className="a-chip">Perplexity</span>
                <span className="a-chip" title={GOOGLE_SURFACES_PLAIN}>
                  Google AI Overviews
                </span>
                <span className="a-chip opt" title={GOOGLE_SURFACES_PLAIN}>
                  Google AI Mode · per client
                </span>
                <span className="a-chip opt">Grok · from Growth</span>
                <span className="a-chip opt">Claude · from Growth</span>
              </div>
              <ul className="trust-strip" aria-label="How client data is handled" data-testid="trust-strip">
                {TRUST.map((item) => (
                  <li key={item.label}>
                    <Link href={item.href}>{item.label}</Link>
                  </li>
                ))}
              </ul>
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

      {/* исследование и счётчик: настоящие данные вместо отзывов, которых ещё нет */}
      <section className="sec measured-band" aria-label="What we have measured">
        <div className="wrap measured-grid">
          {totals && (
            <dl className="measured-stats" data-testid="measured-totals">
              <div>
                <dt>AI answers measured</dt>
                <dd>{int(totals.answers + RESEARCH_ANSWERS)}</dd>
              </div>
              {/* Источники ответов исследования в базу не писались — пока их меньше ответов, строка не показывается. */}
              {totals.citations > totals.answers + RESEARCH_ANSWERS && (
                <div>
                  <dt>Cited sources read</dt>
                  <dd>{int(totals.citations)}</dd>
                </div>
              )}
            </dl>
          )}
          <div className="measured-teaser">
            <div className="kicker">Research · field notes #1</div>
            <p className="h4">
              Smaller brands were named in 51% to 87% of answers when the question fit what they do
              differently. Buying questions were their weak spot.
            </p>
            <Link className="link" href="/research">
              {RESEARCH_ANSWERS} answers, five brands, every question published →
            </Link>
          </div>
        </div>
      </section>

      {/* 1 · деньги агентства */}
      <section className="sec" id="service">
        <div className="wrap">
          <SecHead n={1} title="A new service for clients you already have">
            Your clients already ask what ChatGPT says about them. You have the relationship, the SEO
            team and the reporting habit. What is missing is a way to measure it and something to
            hand over, and that is the part Answertally does, so the service does not start with a
            new hire.
          </SecHead>
          <div className="notes2">
            {[MARKET_NOTE, BUYER_NOTE].map((note) => (
              <figure className="market-note" key={note.source}>
                <blockquote>{note.text}</blockquote>
                <figcaption>
                  <a href={note.href} rel="noopener noreferrer" target="_blank">
                    {note.source}
                  </a>
                </figcaption>
              </figure>
            ))}
          </div>
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
                plan. No per-seat or per-prompt pricing.
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
                Your logo and color on a page the client opens without an account. They approve the
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
          <div className="ctas" style={{ marginTop: 36 }}>
            <Link className="btn primary" href="/signup">
              Run a free audit
            </Link>
            <Link className="link" href="/sample-report">
              Open the full example report →
            </Link>
          </div>
          <CtaNote />
        </div>
      </section>

      {/* 4 · отличие от «балла»: главный аргумент против остального рынка */}
      <section className="sec" id="evidence">
        <div className="wrap">
          <SecHead n={4} title="Evidence, not a score">
            A single score or a rank is easy to sell and impossible for your client to check. The
            first time it swings for no reason, the agency takes the blame. Answertally shows the
            answers behind every number instead.
          </SecHead>
          <div className="split even">
            <div className="side">
              <h3 className="h4">What we never claim</h3>
              <ul className="never x" data-testid="landing-never">
                {METHOD_COPY.neverClaim.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
            <div className="side">
              <h3 className="h4">Where it fits in your client’s numbers</h3>
              <ol className="chain" data-testid="landing-chain">
                {CHAIN.map((step) => (
                  <li key={step.label} className={step.ours ? "ours" : undefined}>
                    <b>{step.label}</b>
                    <span>{step.note}</span>
                  </li>
                ))}
              </ol>
              <p className="small muted" style={{ marginTop: 12 }}>
                We measure the first three. Your client’s analytics already covers the rest, so the
                story from AI answers to revenue is told with numbers each side can check.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 5 · возражения */}
      <section className="sec" id="questions">
        <div className="wrap">
          <SecHead n={5} title="What agencies ask before they buy">
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

      {/* 6 · тарифы коротко */}
      <section className="sec" id="pricing">
        <div className="wrap">
          <SecHead n={6} title="Priced per client, your team included">
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
            <CtaNote />
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
