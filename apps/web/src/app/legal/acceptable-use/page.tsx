import type { Metadata } from "next";
import Link from "next/link";

/**
 * Правила использования.
 *
 * Нужны нам раньше, чем обычному SaaS, по двум причинам. Первая: продукт
 * умеет задавать ассистентам любой вопрос, и через нас на поставщиков
 * распространяются их же правила — нарушит агентство, отвечать будем мы.
 * Вторая: тем же продуктом можно следить за человеком, а не за компанией,
 * и это надо запретить словами, а не надеяться, что никто не догадается.
 */

export const metadata: Metadata = {
  title: "Acceptable use · Answertally",
  description: "What Answertally may not be used for, and what happens if it is.",
};

export default function AcceptableUsePage() {
  return (
    <>
      <h1>Acceptable use</h1>
      <p className="lede">
        Short, and part of the <Link href="/legal/terms">terms of service</Link>. Most of it is
        obvious; two parts are specific to what this product can do, and those are the ones worth
        reading.
      </p>

      <h2>Measure companies, not people</h2>
      <p>
        Answertally is for measuring how brands appear in assistant answers. Do not use it to track,
        profile or build a picture of a private individual — by making a person the subject of the
        tracked questions, or by using the stored answers to find things out about someone.
      </p>
      <p>
        Public figures acting in a professional capacity are a grey area rather than an exception:
        measuring how a consultancy is described is fine, compiling what assistants say about a
        named person is not. If you are unsure, ask before you run it.
      </p>

      <h2>The assistants&rsquo; rules reach you through us</h2>
      <p>
        We ask the assistant providers your questions under our agreements with them. Their rules
        therefore apply to what you send, and a breach by you is a breach by us.
      </p>
      <p>In practice: do not use the product to</p>
      <ul>
        <li>generate content that the providers prohibit — harassment, deception, illegal material;</li>
        <li>extract model output at volume for some other purpose, or as a way around a provider&rsquo;s own pricing;</li>
        <li>present an assistant&rsquo;s answer as a statement of fact about a company when it is not.</li>
      </ul>

      <h2>Honest reporting</h2>
      <p>
        The product deliberately refuses to state more than the evidence supports: shares come with
        ranges and confidence, and a change too small to distinguish from noise is labelled that
        way. Do not strip that framing out when you pass a report on.
      </p>
      <p>
        Specifically: do not present an estimate as a measured fact, do not describe a figure as
        showing that your work made something happen, and do not remove the caveats from a report
        before sending it. You are free to disagree with our method in public — the{" "}
        <Link href="/method">method page</Link> exists so that argument can be had properly.
      </p>

      <h2>The ordinary things</h2>
      <ul>
        <li>Do not share accounts, or resell access to the product as a product.</li>
        <li>Do not probe, scrape or overload the service, or work around its limits.</li>
        <li>Do not upload material you have no right to, or measure brands you have no business measuring.</li>
        <li>Do not use the service to break the law, wherever you or your clients are.</li>
      </ul>

      <h2>What happens if this is breached</h2>
      <p>
        We will normally tell you and give you a chance to fix it. Where the use is causing harm, or
        where a provider requires us to act immediately, we may suspend first and explain after.
      </p>
      <p>
        We would rather have the conversation. If something you want to do sits near a line here,
        ask — the answer is often yes with a caveat, and we would prefer to say so in advance than
        to find out afterwards.
      </p>
    </>
  );
}
