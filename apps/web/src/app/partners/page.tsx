import type { Metadata } from "next";
import Link from "next/link";
import {
  MARKETING_COPY,
  METHOD_COPY,
  PARTNER_COPY,
  partnerTerms,
  REFERRAL_MONTHS,
  REFERRAL_RATE,
  VOLUME_ACCOUNT_PRICE_USD,
  VOLUME_DISCOUNT,
  VOLUME_THRESHOLD,
} from "@repo/core";
import { Faq, MethodLink, SecHead } from "@/components/marketing/bits";
import { MarketingShell } from "@/components/marketing/chrome";
import { checkoutCopy, PRICING_NOTES, RESALE } from "@/components/marketing/content";
import { getPaymentProvider } from "@/server/payments";
import { PER_CLIENT_MAX, PER_CLIENT_MIN, PLANS, usd } from "@/components/marketing/data";
import { ResaleCalculator } from "@/components/marketing/resale-calculator";
import { SalesCta } from "./sales-cta";

/**
 * Страница для агентств, которые хотят продавать AI-поиск как свою услугу.
 *
 * Отличие от /pricing: там — что стоит план, здесь — что агентство с этим
 * делает у себя. Поэтому цифры те же самые (`PLANS`, `PER_CLIENT_*`), а не
 * вторая версия прайса: две страницы, спорящие о цене, хуже одной.
 *
 * Чего здесь нет намеренно: отзывов, логотипов клиентов, числа агентств на
 * борту и обещанной маржи. Ничего из этого пока не существует, а страница,
 * которая придумывает себе клиентов, торгует ровно тем доверием, ради
 * которого весь продукт и затеян.
 */

// Признак оплаты — из env рантайма, а не сборки (см. /pricing).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  alternates: { canonical: "/partners" },
  title: "White-Label AI Visibility Reports for Agencies · Answertally",
  description:
    "Run AI-visibility measurement as your own service: a workspace per client, reports in your brand, priced per client account. You set your own price and keep the client relationship.",
};

/**
 * Условия с подставленными числами.
 *
 * Собираются один раз и используются и в разделе, и в вопросах: две
 * формулировки одного условия на одной странице — это два обещания, из
 * которых агентство выберет выгодное для себя, и будет право.
 */
const TERMS = partnerTerms({
  threshold: VOLUME_THRESHOLD,
  accountPriceUsd: VOLUME_ACCOUNT_PRICE_USD,
  discountPct: Math.round(VOLUME_DISCOUNT * 100),
  referralPct: Math.round(REFERRAL_RATE * 100),
  referralMonths: REFERRAL_MONTHS,
});

/** Что агентство получает. Каждый пункт — то, что уже работает в продукте. */
const WHAT_YOU_GET = [
  {
    title: "Reports in your brand",
    body: `${MARKETING_COPY.whiteLabel.page} ${MARKETING_COPY.whiteLabel.link}`,
  },
  {
    title: "A workspace per client",
    body: "Each client is its own account: its own questions, competitors, measurements, ranked work and reports. Your team sees all of them; a client sees only the report you send.",
  },
  {
    title: "Approval, not a download button",
    body: `${MARKETING_COPY.whiteLabel.approve} ${MARKETING_COPY.whiteLabel.pdf}`,
  },
  {
    title: "Priced per client account",
    body: `${PRICING_NOTES.unit} ${PRICING_NOTES.seats}`,
  },
  {
    title: "The free audit as a pitch",
    body: `Run a full audit on a prospect before anyone signs anything, and show the client what assistants say about them today. ${MARKETING_COPY.auditSnapshot}`,
  },
  {
    title: "Next to your SEO suite, not instead of it",
    body: PRICING_NOTES.seoSuite,
  },
];

/** Где проходит граница: мы не разговариваем с клиентом агентства. */
const THE_LINE = [
  {
    title: "You set the price",
    body: "What you charge your client is your decision and your contract. We bill you for the plan; we never see or set your client's price.",
  },
  {
    title: "You own the relationship",
    body: "We do not contact your client, do not market to them and do not appear in the report as a vendor. The only thing that reaches them is the report you send.",
  },
  {
    title: "Nothing is published for you",
    body: MARKETING_COPY.limits.nothingPublished,
  },
  {
    title: "Partner terms do not change any of the above",
    body: `${PARTNER_COPY.notIncluded} The wholesale rate and the referral commission are money between us and you; your client never sees either.`,
  },
];

/** Шаги — ровно то, что агентство делает в продукте, без обещанных сроков. */
const START_STEPS = [
  "Create a workspace and add one brand you already work on. No card is asked for.",
  "Generate the buyer questions from templates or import your own, then edit them until they read the way that client's buyers actually ask.",
  "Run the free audit and read the diagnosis: where the client is named, where a competitor is named instead, and which sources the assistants cited.",
  "Send the report in your own brand and use it as the pitch for the retainer line you want to sell.",
  "If the client says yes, add the rest of your book on a plan that covers them.",
];

function faqItems(paymentsOn: boolean) {
  return [
  {
    q: "Can we put our own logo on everything the client sees?",
    a: `${MARKETING_COPY.whiteLabel.page} ${MARKETING_COPY.whiteLabel.email} ${MARKETING_COPY.whiteLabel.link}`,
  },
  {
    q: "What should we charge for this?",
    a: "That is yours to decide, and we deliberately do not publish a recommended rate — we have no market data that would make one honest. The calculator above does arithmetic on the numbers you type in, so you can see what a price would mean against the plan that covers those clients.",
  },
  {
    q: "Is there a partner programme or revenue share?",
    a: `Yes, and both parts are printed above rather than described. ${TERMS.volume} ${TERMS.referral} ${PARTNER_COPY.howItRuns}`,
  },
  {
    q: "Do we have to commit to anything for the wholesale rate?",
    a: `${PARTNER_COPY.notIncluded} The rate follows the number of client accounts you actually run, so it appears when you cross ${VOLUME_THRESHOLD} and goes away if you drop back below.`,
  },
  {
    q: "What does it cost us per client?",
    a: `With the plan full: ${PLANS.map((p) => `${p.name} about ${usd(p.perClientUsd)}`).join(", ")} per client a month, your whole team included. ${checkoutCopy(paymentsOn).note}`,
  },
  {
    q: "Can we show a client the measurement before they buy?",
    a: `Yes — that is what the free audit is for. It runs on a prospect account and produces the same report your paying clients get. ${MARKETING_COPY.auditNotForecast}`,
  },
  {
    q: "What do we have to be able to say to a client?",
    a: "Everything on the method page, in plain words: no rank, no single score, figures with ranges and a confidence level, and a record of what followed the work rather than a claim about why. If your pitch needs more certainty than that, this is the wrong tool for it.",
  },
  {
    q: "Do we need a specialist to run it?",
    a: "Someone on the team has to read the diagnosis and decide what work is worth doing — the product ranks opportunities and writes the reason for each, but it does not choose for you, and it never changes a client's site.",
  },
  ];
}

export default function PartnersPage() {
  // Признак тот же, что рисует кнопку оплаты в продукте.
  const paymentsOn = getPaymentProvider().configured;

  return (
    <MarketingShell>
      <div className="wrap">
        <section className="p-hero">
          <div>
            <div className="kicker page-kicker">For agencies</div>
            <h1 className="display">
              Sell AI search <em>as your own service.</em>
            </h1>
            <p className="lead">
              You keep the client, the price and the brand. What you get from us is the
              measurement underneath: a workspace per client, the diagnosis of where the
              answers come from, and a report the client opens with your logo on it.
            </p>
            <nav className="jump" aria-label="On this page">
              <a href="#get">
                <i>1</i>What you get
              </a>
              <a href="#money">
                <i>2</i>The money
              </a>
              <a href="#terms">
                <i>3</i>Partner terms
              </a>
              <a href="#line">
                <i>4</i>Where the line is
              </a>
              <a href="#start">
                <i>5</i>How to start
              </a>
              <a href="#never">
                <i>6</i>What we never claim
              </a>
            </nav>
          </div>
          <aside className="card method" aria-label="At a glance" data-testid="partners-summary">
            <div className="cap">At a glance</div>
            <dl>
              <div>
                <dt>What you buy</dt>
                <dd>a plan</dd>
              </div>
              <div>
                <dt>What you sell</dt>
                <dd>your own service</dd>
              </div>
              <div>
                <dt>Billed per</dt>
                <dd>client account</dd>
              </div>
              <div>
                <dt>Seats counted</dt>
                <dd>none</dd>
              </div>
              <div>
                <dt>Cost per client</dt>
                <dd>
                  {usd(PER_CLIENT_MIN)}–{usd(PER_CLIENT_MAX)}
                </dd>
              </div>
              <div>
                {/* Условия названы числами прямо в карточке: агентство с
                    большой книгой сравнивает именно их, и отправлять его за
                    ними на третий экран — значит терять его на первом. */}
                <dt>Above {VOLUME_THRESHOLD} accounts</dt>
                <dd>{usd(VOLUME_ACCOUNT_PRICE_USD)} each</dd>
              </div>
              <div>
                <dt>Referral</dt>
                <dd>
                  {Math.round(REFERRAL_RATE * 100)}% · {REFERRAL_MONTHS} mo
                </dd>
              </div>
              <div>
                <dt>Branding your client sees</dt>
                <dd>yours</dd>
              </div>
            </dl>
            <div className="basis">{MARKETING_COPY.methodNote}</div>
          </aside>
        </section>
      </div>

      {/* 1 · что агентство получает */}
      <section className="sec" id="get">
        <div className="wrap">
          <SecHead n={1} title="What an agency gets">
            Not a reseller portal — the same product your team works in, with the client-facing
            half carrying your brand instead of ours.
          </SecHead>
          <ul className="incl" data-testid="partners-get">
            {WHAT_YOU_GET.map((item, i) => (
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

      {/* 2 · деньги на стороне агентства */}
      <section className="sec" id="money">
        <div className="wrap">
          <SecHead n={2} title="How the money works on your side">
            You buy a plan at a listed price and charge your client whatever your own offer is
            worth. The difference is yours, and it is not a number we can promise you — it
            depends on your price and on how many clients say yes.
          </SecHead>
          <ResaleCalculator
            plans={PLANS.map((plan) => ({
              id: plan.id,
              name: plan.name,
              priceUsd: plan.priceUsd,
              clientLimit: plan.clientLimit,
            }))}
            title={RESALE.title}
            intro={RESALE.intro}
            caveat={RESALE.caveat}
            defaultPriceUsd={RESALE.defaultPriceUsd}
            defaultClients={RESALE.defaultClients}
          />
          <div className="g2" style={{ marginTop: 20 }}>
            <div className="limit">
              <h3>Illustrative, not a rate card</h3>
              <p>
                The starting values in the calculator are placeholders so the fields are not
                empty. We publish no recommended resale price and no expected margin: we have no
                data that would make either of those honest.
              </p>
            </div>
            <div className="limit">
              <h3>What the arithmetic leaves out</h3>
              <p>
                Your team&rsquo;s hours on the work the diagnosis surfaces, the time it takes to
                sell the line in the first place, and the clients who say no. Put your own
                numbers in and the result is still only arithmetic.
              </p>
            </div>
          </div>
          <div className="row-between">
            <p className="small">{PRICING_NOTES.frame}</p>
            <Link className="link" href="/pricing">
              See the plans and what an AI check is →
            </Link>
          </div>
        </div>
      </section>

      {/*
        Партнёрские условия стоят после раздела про деньги и до раздела про
        границу: сначала агентство считает свою экономику на списочной цене,
        потом видит, что при объёме она другая, и только потом читает, чего
        программа не меняет.
      */}
      <section className="sec" id="terms">
        <div className="wrap">
          <SecHead n={3} title="Partner terms, with the numbers">
            {PARTNER_COPY.published}
          </SecHead>
          <div className="g2" data-testid="partner-terms">
            <div className="limit">
              <h3>Wholesale rate on volume</h3>
              <p data-testid="partner-volume">{TERMS.volume}</p>
              <p className="small" style={{ marginTop: 12 }}>
                {PARTNER_COPY.volumeShape}
              </p>
            </div>
            <div className="limit">
              <h3>Referral commission</h3>
              <p data-testid="partner-referral">{TERMS.referral}</p>
              <p className="small" style={{ marginTop: 12 }}>
                {PARTNER_COPY.howItRuns}
              </p>
            </div>
          </div>
          <div className="row-between">
            <p className="small">{PARTNER_COPY.notIncluded}</p>
            <Link className="link" href="/pricing">
              See the plans these terms sit on top of →
            </Link>
          </div>
        </div>
      </section>

      {/* 4 · где проходит граница */}
      <section className="sec" id="line">
        <div className="wrap">
          <SecHead n={4} title="Where the line is">
            Worth being blunt about, because you are the one standing in front of the client.
          </SecHead>
          <div className="g2" data-testid="partners-line">
            {THE_LINE.map((item) => (
              <div className="limit" key={item.title}>
                <h3>{item.title}</h3>
                <p>{item.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* 5 · как начать */}
      <section className="sec" id="start">
        <div className="wrap">
          <SecHead n={5} title="How to start">
            Nothing here needs a contract or a call. The order matters more than the speed: the
            audit is what turns a conversation into an offer.
          </SecHead>
          <div className="split even">
            <ol className="steps" data-testid="partners-steps">
              {START_STEPS.map((step) => (
                <li key={step}>{step}</li>
              ))}
            </ol>
            <div className="card pad">
              <div className="cap" style={{ marginBottom: 10 }}>
                Useful before you pitch
              </div>
              <ul className="rules">
                <li>
                  <span>
                    <b>The proposal template.</b> The structure of an AI-visibility proposal —
                    what to measure, what to report, what not to promise — with example values
                    you replace. <Link href="/proposal-template">Open it →</Link>
                  </span>
                </li>
                <li>
                  <span>
                    <b>A sample report.</b> The document your client actually receives, in an
                    example agency&rsquo;s brand. <Link href="/sample-report">See it →</Link>
                  </span>
                </li>
                <li>
                  <span>
                    <b>The method.</b> The page you can send a sceptical client without
                    rewriting anything. <MethodLink>Read it →</MethodLink>
                  </span>
                </li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* 6 · чего мы не утверждаем — агентство перепродаёт и эти пределы тоже */}
      <section className="sec" id="never">
        <div className="wrap">
          <SecHead n={6} title="What we never claim — and neither should your pitch">
            You are going to repeat these lines to your own client, so they are here rather than
            in a footnote.
          </SecHead>
          <div className="split">
            <ul className="never x" data-testid="partners-never">
              {METHOD_COPY.neverClaim.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
            <div className="g2">
              <div className="limit">
                <h3>A quarter, not a week</h3>
                <p>{MARKETING_COPY.limits.quarter}</p>
              </div>
              <div className="limit">
                <h3>Movement, not attribution</h3>
                <p>{MARKETING_COPY.limits.attribution}</p>
              </div>
              <div className="limit">
                <h3>Ranges, not exact numbers</h3>
                <p>{MARKETING_COPY.limits.ranges}</p>
              </div>
              <div className="limit">
                <h3>No revenue figure invented for you</h3>
                <p>{MARKETING_COPY.limits.revenue}</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="sec">
        <div className="wrap">
          <SecHead n={7} title="Questions agencies ask first" />
          <Faq items={faqItems(paymentsOn)} testId="partners-faq" />
        </div>
      </section>

      <section className="sec">
        <div className="wrap closing">
          <h2 className="h1">Try it on a client you already have</h2>
          <div>
            <p className="prose">
              The audit costs nothing and produces the report you would send. That is a better
              basis for deciding whether to sell this than anything written on this page.
            </p>
            <div className="ctas" style={{ marginTop: 22 }}>
              <Link className="btn primary" href="/signup">
                Start a free audit
              </Link>
              <SalesCta fallbackLabel="See what the audit includes" fallbackHref="/free-audit" />
            </div>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
