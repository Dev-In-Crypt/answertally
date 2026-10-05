import type { Metadata } from "next";
import Link from "next/link";
import { MARKETING_COPY, VOLUME_ACCOUNT_PRICE_USD, VOLUME_DISCOUNT, VOLUME_THRESHOLD } from "@repo/core";
import { CtaNote, Faq, SecHead, TalkOrAudit } from "@/components/marketing/bits";
import { MarketingShell } from "@/components/marketing/chrome";
import { checkoutCopy, PRICING_NOTES, RESALE, SALES_CONTACT } from "@/components/marketing/content";
import { getPaymentProvider } from "@/server/payments";
import {
  PER_CLIENT_MAX,
  PER_CLIENT_MIN,
  PLANS,
  TYPICAL_CHECKS_PER_CLIENT,
  int,
  usd,
} from "@/components/marketing/data";
import { ResaleCalculator } from "@/components/marketing/resale-calculator";

/**
 * Тарифы.
 *
 * Суммы, лимиты и цена за клиента — только из `PLAN_LIMITS` (через `PLANS`),
 * никаких литералов: это те же числа, по которым API ограничивает клиентов.
 * Условия — только утверждённые основателем (см. `PRICING_NOTES`); чего нет
 * в утверждённом, того нет и на странице.
 */

/**
 * Рендер на каждый запрос, как у главной: признак оплаты читается из env
 * рантайма. При пререндере он запекался из окружения сборки, где ключа
 * провайдера нет, и страница говорила «оплаты картой нет», когда она была.
 */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  alternates: { canonical: "/pricing" },
  title: "Pricing: AI Visibility Tracking per Client · Answertally",
  description: `Three plans, billed per client account with your whole team included: ${PLANS.map((p) => `${p.name} ${usd(p.priceUsd)}`).join(", ")} a month, about ${usd(PER_CLIENT_MIN)}–${usd(PER_CLIENT_MAX)} per client.`,
};

const clientLimits = PLANS.map((p) => p.clientLimit);
const clientLimitsText = `${clientLimits.slice(0, -1).join(", ")} or ${clientLimits.at(-1)}`;

const INCLUDED = [
  {
    title: "Measurement",
    body: `Three assistants on Starter; all four from Growth, switched on per client. ${MARKETING_COPY.sampleFloor} ${MARKETING_COPY.cadence}`,
  },
  {
    title: "Diagnosis",
    body: "The sources assistants cite, grouped by kind, with where competitors appear and your client does not.",
  },
  {
    title: "Actions board",
    body: "Ranked opportunities, each with a reason, turned into work with an owner and a brief.",
  },
  {
    title: "Experiments",
    body: "What followed the work you mark done, compared with the client’s untouched topics, shown as an estimate with a confidence level.",
  },
  {
    title: "White-label reports",
    body: `${MARKETING_COPY.whiteLabel.page} The client approves by link.`,
  },
  { title: "PDF export", body: "Download the same report as a PDF, for clients who forward documents rather than links." },
];

function faqItems(paymentsOn: boolean) {
  return [
  {
    q: "What does it cost per client?",
    a: `With the plan full: ${PLANS.map((p) => `${p.name} about ${usd(p.perClientUsd)}`).join(", ")} per client a month. Your team is not counted.`,
  },
  { q: "Do you charge per seat?", a: `No. ${PRICING_NOTES.unit} ${PRICING_NOTES.seats}` },
  { q: "What exactly is an AI check?", a: PRICING_NOTES.checks },
  { q: "What happens if we go past the allowance?", a: PRICING_NOTES.overage },
  { q: "What if we need more clients than the plan allows?", a: PRICING_NOTES.clientLimit },
  { q: "Do extra assistants cost extra?", a: PRICING_NOTES.extraAssistants },
  { q: "Do we have to drop Semrush or Ahrefs?", a: `No. ${PRICING_NOTES.seoSuite}` },
  { q: "Can we pay by card on the site?", a: checkoutCopy(paymentsOn).faqAnswer },
  {
    q: "Who takes the payment, and what about tax?",
    a: "Creem, our merchant of record, takes the card payment, adds sales tax or VAT where it applies and issues the invoice. We never see your card number.",
  },
  {
    q: "How do we cancel?",
    a: (
      <>
        In the product, any time, with no notice period. The subscription runs to the end of the
        month you have already paid for, and the report links you sent keep working until then.{" "}
        <Link href="/legal/refunds">Billing and refunds</Link>
      </>
    ),
  },
  {
    q: "Can we get a refund?",
    a: (
      <>
        Not for a month that has started: the free audit exists so you can decide first. A wrong
        charge is refunded in full, and if measurement was broken on our side we refund or credit
        that part. <Link href="/legal/refunds">The full policy</Link>
      </>
    ),
  },
  {
    q: "Is the free audit really free?",
    a: "Yes. Creating a workspace and running the audit costs nothing, and no card is asked for.",
  },
  ];
}

export default function PricingPage() {
  // Тот же признак, что рисует кнопку оплаты в продукте: витрина не должна
  // обещать ни больше, ни меньше того, что агентство увидит после входа.
  const paymentsOn = getPaymentProvider().configured;
  const buying = checkoutCopy(paymentsOn);

  return (
    <MarketingShell active="pricing">
      <div className="wrap">
        <section className="pr-hero">
          <div>
            <div className="kicker page-kicker">Pricing</div>
            <h1 className="display">
              Priced per client, <em>with your whole team included.</em>
            </h1>
            <p className="lead">
              {PRICING_NOTES.unit} {PRICING_NOTES.included} {PRICING_NOTES.frame}
            </p>
          </div>
          <aside className="card howbuy">
            <div className="cap">How buying works today</div>
            <p className="h4">{buying.heading}</p>
            <p className="small">{buying.lead}</p>
            <Link className="btn primary" href="/signup">
              Run a free audit
            </Link>
            <CtaNote>Free for one brand. No card needed. You pick a plan after the audit, inside the product.</CtaNote>
            {SALES_CONTACT && <TalkOrAudit />}
          </aside>
        </section>

        <p className="plan-guide" data-testid="plan-guide">
          Pick by how many brands you measure at once: up to {PLANS[0]!.clientLimit} on{" "}
          {PLANS[0]!.name}, up to {PLANS[1]!.clientLimit} on {PLANS[1]!.name}, up to{" "}
          {PLANS[2]!.clientLimit} on {PLANS[2]!.name}. Not sure yet? Run the free audit first.
        </p>

        <ul className="plans" aria-label="Plans" data-testid="pricing-plans">
          {PLANS.map((plan) => (
            <li key={plan.id} className="card plan" data-testid={`plan-${plan.id}`}>
              <div>
                <h2 className="name">{plan.name}</h2>
                <p className="aud-line">{plan.audience}</p>
              </div>
              <div className="price">
                <b data-testid={`plan-price-${plan.id}`}>{usd(plan.priceUsd)}</b>
                <span>/ month</span>
              </div>
              <p className="per-client">
                ≈ <b data-testid={`plan-per-client-${plan.id}`}>{usd(plan.perClientUsd)}</b> per client
                a month with the plan full
              </p>
              <dl className="kv">
                <div>
                  <dt>Client accounts</dt>
                  <dd data-testid={`plan-clients-${plan.id}`}>up to {plan.clientLimit}</dd>
                </div>
                <div>
                  <dt>AI checks / month</dt>
                  <dd data-testid={`plan-checks-${plan.id}`}>{int(plan.aiCheckAllowance)}</dd>
                </div>
                <div>
                  <dt>Assistants</dt>
                  <dd data-testid={`plan-assistants-${plan.id}`}>{plan.assistants}</dd>
                </div>
              </dl>
              <p className="per">≈ {int(plan.checksPerClient)} checks per client a month</p>
              <ul>
                <li>Measurement, diagnosis and reports on every client</li>
                <li>White-label reports and PDF export</li>
                <li>No charge per seat</li>
              </ul>
              <Link className="btn secondary" href="/signup">
                Run a free audit
              </Link>
            </li>
          ))}
        </ul>
      </div>

      {/* 1 · перепродажа */}
      <section className="sec" id="resale">
        <div className="wrap">
          <SecHead n={1} title="Price the service before you buy anything">
            You can sell AI visibility as its own line item or inside a retainer. Only you know what
            your clients will pay, so the calculator below uses your numbers, not ours.
          </SecHead>
          <ResaleCalculator
            plans={PLANS.map(({ id, name, priceUsd, clientLimit }) => ({ id, name, priceUsd, clientLimit }))}
            title={RESALE.title}
            intro={RESALE.intro}
            caveat={RESALE.caveat}
            defaultPriceUsd={RESALE.defaultPriceUsd}
            defaultClients={RESALE.defaultClients}
          />
          <div className="note" style={{ marginTop: 20 }} data-testid="seo-suite">
            {PRICING_NOTES.seoSuite}
          </div>
        </div>
      </section>

      {/* 2 · единицы */}
      <section className="sec">
        <div className="wrap">
          <SecHead n={2} title="Two units: clients and AI checks">
            The plan limits two things. Everything else, including the number of people on your
            team, is not counted.
          </SecHead>
          <div className="defs">
            <div className="card def">
              <div className="cap">What counts as a client</div>
              <p className="big">
                One brand you measure, with its own prompts, competitors, sources, board and reports.
              </p>
              <p className="small">
                The plan sets how many client accounts the workspace can hold at once:{" "}
                {clientLimitsText}. Adding one beyond that means moving to the next plan, and the
                product asks you to rather than failing quietly.
              </p>
              {/*
                Над старшим тарифом следующего плана нет, и до сих пор страница
                об этом молчала. Число напечатано здесь же, а не спрятано в
                «напишите нам»: это и есть условие, а не приглашение к торгу.
              */}
              <p className="small" data-testid="volume-rate">
                Above {VOLUME_THRESHOLD} accounts there is no next plan: every further client
                account is {usd(VOLUME_ACCOUNT_PRICE_USD)} a month,{" "}
                {Math.round(VOLUME_DISCOUNT * 100)}% off what the top plan works out to per
                account. <Link className="link" href="/partners#terms">The full terms are here</Link>.
              </p>
              <div className="basis">Billing unit: the client account. Not seats, not sources, not prompts.</div>
            </div>
            <div className="card def">
              <div className="cap">What an AI check is</div>
              <p className="big">One answer from one assistant to one prompt.</p>
              <div className="eq" role="img" aria-label="1 prompt times 1 assistant times 1 answer equals 1 AI check">
                <span className="t"><b>1</b><span>prompt</span></span>
                <span className="op">×</span>
                <span className="t"><b>1</b><span>assistant</span></span>
                <span className="op">×</span>
                <span className="t"><b>1</b><span>answer</span></span>
                <span className="op">=</span>
                <span className="t res"><b>1</b><span>AI check</span></span>
              </div>
              <div className="basis">
                Asking the same prompt three times on ChatGPT is three checks. A figure needs at
                least three answers per prompt per assistant.
              </div>
            </div>
          </div>

          <div className="card use" data-testid="allowance">
            <div>
              <div className="h4">How far the allowance goes</div>
              <p className="small" style={{ marginTop: 4 }} data-testid="pricing-checks">
                {PRICING_NOTES.checks}
              </p>
            </div>
            {PLANS.map((plan) => (
              <div className="use-row" key={plan.id}>
                <span className="n">{plan.name}</span>
                <span className="meter" aria-hidden>
                  <i style={{ width: `${Math.round((plan.typicalUse / plan.aiCheckAllowance) * 100)}%` }} />
                </span>
                <span className="v">
                  {plan.clientLimit} × {int(TYPICAL_CHECKS_PER_CLIENT)} ≈ {int(plan.typicalUse)} of{" "}
                  {int(plan.aiCheckAllowance)}
                </span>
              </div>
            ))}
            <div className="legend" style={{ fontSize: 12.5 }}>
              <span>
                <i className="sw" style={{ height: 10, background: "#3C414B" }} />
                every client full, measured weekly
              </span>
              <span>
                <i className="sw" style={{ height: 10, background: "#EFEDE7" }} />
                headroom in the allowance
              </span>
            </div>
            <div className="basis">
              {PRICING_NOTES.extraAssistants} {PRICING_NOTES.overage}
            </div>
          </div>
        </div>
      </section>

      {/* 3 · что входит */}
      <section className="sec">
        <div className="wrap">
          <SecHead n={3} title="Included in every plan">
            {PRICING_NOTES.included} Plans differ only in how many clients and checks they cover.
          </SecHead>
          <ol className="incl">
            {INCLUDED.map((item, i) => (
              <li key={item.title}>
                <span className="num">{i + 1}</span>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* 4 · как купить */}
      <section className="sec">
        <div className="wrap">
          <SecHead n={4} title="How to start">
            {buying.note} This is the actual path.
          </SecHead>
          <ol className="buy">
            <li className="card">
              <span className="num">1</span>
              <h3>Run the free audit</h3>
              <p>Create a workspace and audit a brand you work on — a client's, or your own. Nothing is charged to run it.</p>
            </li>
            <li className="card">
              <span className="num">2</span>
              <h3>{buying.stepPickTitle}</h3>
              <p>{buying.stepPick}</p>
              {SALES_CONTACT && (
                <p style={{ marginTop: 10 }}>
                  <TalkOrAudit />
                </p>
              )}
            </li>
            <li className="card">
              <span className="num">3</span>
              <h3>Billing is set up</h3>
              <p>{buying.stepBilling}</p>
            </li>
          </ol>
        </div>
      </section>

      {/* 5 · вопросы */}
      <section className="sec">
        <div className="wrap">
          <SecHead n={5} title="Billing questions" />
          <Faq items={faqItems(paymentsOn)} testId="pricing-faq" />
        </div>
      </section>

      <section className="sec">
        <div className="wrap closing">
          <h2 className="h1">Price it against the retainer, after you have seen one audit</h2>
          <div>
            <p className="prose">
              Run the audit on one client first. You will see what the output looks like, and what
              you could charge for it, before any plan is agreed.
            </p>
            <div className="ctas" style={{ marginTop: 22 }}>
              <Link className="btn primary" href="/signup">
                Run a free audit
              </Link>
            </div>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
