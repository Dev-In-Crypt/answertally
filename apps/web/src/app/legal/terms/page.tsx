import type { Metadata } from "next";
import Link from "next/link";
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
        This agreement is between {us} (&ldquo;we&rdquo;, &ldquo;us&rdquo;) and the organisation
        whose workspace this is (&ldquo;you&rdquo;). The person who creates the workspace confirms
        they may accept these terms on that organisation&rsquo;s behalf.
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
        You may add the brands you work on, whether they are your clients&rsquo; or your own. By
        adding a brand you confirm that you are entitled to measure it and to share the resulting
        reports with the people you send them to.
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
        use it to run the service for you, and for nothing else. We do not train models on it and we
        do not use one customer&rsquo;s data to improve what another customer sees.
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
        holds and how many AI checks it includes in a month. One AI check is one assistant answering
        one question once.
      </p>
      <p>
        Measurement runs within the AI-check limit of the plan you chose. When the checks included
        for the month are used up, new measurement waits until the next billing period starts or
        you move to a larger plan; nothing already measured is lost, and your reports stay open.
        Before a plan is bought, free use is capped: the free audit covers a set number of checks
        and then asks you to choose a plan.
      </p>
      <p>
        Cancellation, refunds and what happens to a downgrade are in{" "}
        <Link href="/legal/refunds">billing and refunds</Link>.
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
        fixed within the period we allow, if the product is used in a way that breaches the
        acceptable use policy, or if we are required to.
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
