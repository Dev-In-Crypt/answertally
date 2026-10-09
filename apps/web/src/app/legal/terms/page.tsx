import type { Metadata } from "next";
import Link from "next/link";
import {
  CHECK_WEIGHTS,
  FREE_CHECK_ALLOWANCE,
  partnerTerms,
  REFERRAL_MONTHS,
  REFERRAL_RATE,
  VOLUME_ACCOUNT_PRICE_USD,
  VOLUME_DISCOUNT,
  VOLUME_THRESHOLD,
} from "@repo/core";
import { LEGAL_ENTITY } from "@/config/legal";
import { SUPPORT_EMAIL } from "@/config/site";

/**
 * Условия использования.
 *
 * Написаны под наш случай, а не по шаблону. Три вещи, которых в шаблоне
 * не бывает и которые здесь обязаны быть:
 *
 * 1. Сторон три. Платит агентство, измеряется бренд его клиента, отчёт
 *    читает этот клиент. Шаблон предполагает, что платящий владеет всем,
 *    что измеряют, — для всего агентского сегмента это неправда.
 * 2. Мы не продаём доступ к моделям. Условия поставщиков запрещают
 *    перепродажу, и мы не можем выдать агентству больше прав, чем есть у
 *    нас самих.
 * 3. Цифры — оценка по выборке. Продукт нигде не обещает попадание в
 *    ответы, и условия обязаны говорить то же самое, иначе у витрины и у
 *    договора окажутся разные обещания.
 */

export const metadata: Metadata = {
  alternates: { canonical: "/legal/terms" },
  title: "Terms of service · Answertally",
  description: "The agreement between your agency and Answertally, in plain language.",
};

/** Те же условия, что на /partners: договор и витрина не должны обещать разное. */
const PARTNER = partnerTerms({
  threshold: VOLUME_THRESHOLD,
  accountPriceUsd: VOLUME_ACCOUNT_PRICE_USD,
  discountPct: Math.round(VOLUME_DISCOUNT * 100),
  referralPct: Math.round(REFERRAL_RATE * 100),
  referralMonths: REFERRAL_MONTHS,
});

export default function TermsPage() {
  const us = LEGAL_ENTITY?.name ?? "the Answertally team";

  return (
    <>
      <h1>Terms of service</h1>
      <p className="lede">
        These terms cover your use of Answertally. They are written to be read, not to be survived.
        Where something limits what you can expect from us, it says so in the same plain words as
        the rest.
      </p>

      <h2>1. Who is party to this</h2>
      <p>
        This agreement is between {us} (&ldquo;we&rdquo;, &ldquo;us&rdquo;) and the organization
        whose workspace this is (&ldquo;you&rdquo;). The person who creates the workspace confirms
        they may accept these terms on that organization&rsquo;s behalf.
      </p>
      <p>
        Your clients are not party to this agreement. They may receive a report from you and approve
        it, and the notice shown to them on that page governs that, not this document.
      </p>

      <h2>2. What the service does</h2>
      <p>
        Answertally asks AI assistants the questions you set, records their answers, counts how often
        the brands you track are named, groups the sources those answers cite, and turns that into
        ranked work and reports you can share.
      </p>
      <p>
        You decide what is measured. The product does not change anyone&rsquo;s website, publish
        anything, or contact your clients. A report reaches a client when you send the link.
      </p>

      <h3>What the numbers are, and are not</h3>
      <p>
        Every figure is an estimate from a sample of assistant answers over a period. Assistants
        answer the same question differently from one run to the next, so a share is an estimate
        with a range and a confidence level, never a measured fact about a market.
      </p>
      <p>
        We do not promise that any brand will be named in any assistant&rsquo;s answers, that a
        figure will rise, or that any particular action will change one. Assistants may also
        produce answers that are wrong about your client, their competitors or the wider world; the
        product records what was answered, not what is true. Decisions you or your clients take on
        the basis of these figures are yours.
      </p>

      <h2>3. Your workspace and your clients</h2>
      <p>
        You may add the brands you work on, whether they are your clients&rsquo;, your own, or a
        brand you are pitching as a prospective client. By adding a brand you confirm that you are
        entitled to measure it and to share the resulting reports with the people you send them to.
      </p>
      <p>
        You are responsible for who you invite into your workspace and what they do in it. Tell us
        promptly if an account is being used by someone who should not have it.
      </p>

      <h2>4. What we are not selling</h2>
      <p>
        We license the analysis and the reports. We do not resell model access, and this agreement
        gives you no right to use Answertally as a way to reach an assistant provider&rsquo;s API for
        other purposes.
      </p>
      <p>
        The assistant providers set their own rules for the answers they produce, and those rules
        reach you through us. You agree not to use the product in a way that would breach them;
        see the <Link href="/legal/acceptable-use">acceptable use policy</Link>, which is part of
        these terms.
      </p>

      <h3>White-label reports</h3>
      <p>
        Reports carry your brand, and the report page carries no mention of us. You may present the
        report as your agency&rsquo;s work, because the analysis is what you commissioned and the
        recommendations are yours to stand behind.
      </p>
      <p>
        What you may not do is describe the underlying answers as your own output, or present the
        measurement as something other than what it is if asked directly. If a client asks how the
        numbers were produced, you are free to name the assistants and the method. The{" "}
        <Link href="/method">method page</Link> exists for exactly that.
      </p>

      <h2>5. Data</h2>
      <p>
        You keep ownership of everything you put into the product and of the reports it produces. We
        use it to run the service for you, and we may use it in aggregated or de-identified form to
        analyse, improve and develop the service, for example to see which kinds of sources
        assistants cite in a category, or which recommendations tend to be followed by a change. We
        do not sell it, we do not show one customer another customer&rsquo;s identifiable data, and we
        do not train models on it.
      </p>
      <p>
        <b>Shared source index.</b> Part of that aggregate is shown to every customer: which public
        websites the assistants cite, by category (for example &ldquo;encrypted email&rdquo;), with
        counts. It holds only the cited website&rsquo;s domain, the category and the count, never your
        clients&rsquo; names or domains, competitor names, the questions, the answers or which agency
        measured what, and a category appears only once at least three different workspaces have
        measured in it.
      </p>
      <p>
        We do keep the raw answers assistants gave, for as long as the workspace exists. This is not
        an afterthought: parsers improve, and without the original answers an old figure could never
        be recomputed or checked. What happens to that record when you leave is set out in the{" "}
        <Link href="/legal/dpa">data processing terms</Link>, along with the rest of the detail on
        roles, deletion and sub-processors.
      </p>

      <h2>6. Plans, payment and limits</h2>
      <p>
        Plans are billed monthly in advance. Each plan sets how many client accounts a workspace
        holds and how many AI checks it includes in a month. An answer to one question from ChatGPT,
        Perplexity, Claude, Google AI Overviews or AI Mode counts as one AI check, and a Grok answer
        as {CHECK_WEIGHTS.grok}. The month runs from the day your plan was paid, not from the 1st.
      </p>
      <p>
        Measurement runs within the AI-check limit of the plan you chose. When the checks included
        for the month are used up, new measurement waits until the next billing period starts or
        you move to a larger plan; nothing already measured is lost, and your reports stay open.
        Before a plan is bought, free use is capped: the free audit covers up to{" "}
        {FREE_CHECK_ALLOWANCE} AI checks for one brand and then asks you to choose a plan.
      </p>
      <p>
        Cancellation, refunds and what happens to a downgrade are in{" "}
        <Link href="/legal/refunds">billing and refunds</Link>.
      </p>

      <h3>Partner terms</h3>
      <p>
        {PARTNER.volume} {PARTNER.referral}
      </p>

      <h2>7. Availability and change</h2>
      <p>
        We do not commit to a service level on these plans. We aim to keep the product
        running, and we will tell you when something breaks that affects your measurements.
      </p>
      <p>
        Assistants change. A provider may alter its model, its pricing, its terms, or withdraw API
        access entirely, and any of those can change what we can measure or make an assistant
        unavailable. If that happens we will say so plainly and show the gap in the data rather than
        filling it with something that looks like a measurement.
      </p>
      <p>
        We may change these terms. If a change matters to you (what we may do with your data, what
        you pay, what you are promised), we will tell you before it takes effect, and you may leave
        rather than accept it.
      </p>

      <h2>8. Suspension and ending the agreement</h2>
      <p>
        You may stop at any time. We may suspend or end a workspace if payment fails and is not
        fixed within 7 days, if the product is used in a way that breaches the acceptable use
        policy, or if we are required to.
      </p>
      <p>
        <b>Disputed payments.</b> If you dispute a charge with your bank or card issuer instead of
        writing to us, we suspend the workspace while the dispute is open. If the period was used
        (measurements run, reports produced), the amount stays owed, and we may share the record of
        that use with the payment provider to answer the dispute. Write to us first: a wrong charge
        is refunded in full, without a dispute.
      </p>
      <p>
        Where we can, we will warn you first and give you a chance to fix it. Where we cannot,
        because the use is causing harm or we are compelled, we will explain afterwards.
      </p>

      <h2>9. Liability</h2>
      <p>
        Nothing here limits liability that cannot be limited by law, including for death or personal
        injury resulting from negligence, or for fraud.
      </p>
      <p>
        Beyond that, neither side is liable to the other for lost profits, lost business, lost
        goodwill, or indirect or consequential loss. Our total liability arising out of this
        agreement in any twelve-month period is limited to the fees you paid us in that period.
      </p>
      <p>
        We say this plainly because the product produces estimates that people make commercial
        decisions on: the figures are evidence for a decision, not a warranty of an outcome, and
        this clause is what that difference means in money.
      </p>

      <h2>10. The rest</h2>
      <p>
        If a part of this agreement is unenforceable, the rest stands. Not enforcing something once
        does not waive it. You may not transfer this agreement without our consent; we may transfer
        it if the business does, and will tell you.
      </p>
      <p>
        {LEGAL_ENTITY
          ? `These terms are governed by the law of ${LEGAL_ENTITY.governingLaw}, and its courts have jurisdiction.`
          : `If something goes wrong between us, write to ${SUPPORT_EMAIL} first. We answer every message and settle most things that way.`}
      </p>
    </>
  );
}
