import type { Metadata } from "next";
import Link from "next/link";
import { LEGAL_ENTITY } from "@/config/legal";
import { SUPPORT_EMAIL } from "@/config/site";

/**
 * Политика конфиденциальности.
 *
 * Главная особенность нашего случая: ролей две сразу. Для учётных записей
 * и биллинга решения принимаем мы, для данных клиентов агентства — оно.
 * Шаблон знает только одну роль, и от этого весь текст врёт наполовину.
 *
 * Второе: у нас есть человек, который никогда ничего не подписывал —
 * клиент агентства, открывший отчёт по ссылке. Про него здесь сказано
 * отдельно, потому что больше сказать негде.
 */

export const metadata: Metadata = {
  title: "Privacy policy · Answertally",
  description: "What data Answertally holds, why, for how long, and who else can see it.",
};

export default function PrivacyPage() {
  const us = LEGAL_ENTITY?.name ?? "the operator of Answertally";

  return (
    <>
      <h1>Privacy policy</h1>
      <p className="lede">
        What we hold, why we hold it, how long, and who else sees it. Most of what the product
        stores is about companies rather than people; where it is about people, this page says so.
      </p>

      <h2>Two roles, not one</h2>
      <p>
        Answertally sits between an agency and its clients, so our responsibilities split in two, and
        it matters which one applies.
      </p>
      <p>
        <strong>We decide</strong> what happens to the data that makes the service exist: the
        accounts of people on your team, billing records, security logs and error reports. This page
        is the notice for that.
      </p>
      <p>
        <strong>You decide</strong> what happens to the material you put in: which brands are
        measured, which questions are asked, who receives a report. We act on your instructions
        there and nothing else. The terms for that relationship are in the{" "}
        <Link href="/legal/dpa">data processing terms</Link>.
      </p>

      <h2>What we hold</h2>
      <table>
        <thead>
          <tr>
            <th scope="col">What</th>
            <th scope="col">Why</th>
            <th scope="col">How long</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Name, work email, password hash for each person on your team</td>
            <td>To let them in and to know who did what</td>
            <td>While the workspace exists, then removed with it</td>
          </tr>
          <tr>
            <td>Billing contact and plan history</td>
            <td>To take payment and answer questions about an invoice</td>
            <td>As long as tax and accounting rules require</td>
          </tr>
          <tr>
            <td>Card details</td>
            <td>We never receive them — they are entered on Stripe</td>
            <td>Not held by us at all</td>
          </tr>
          <tr>
            <td>Brands, questions, competitors you add</td>
            <td>To measure what you asked for</td>
            <td>Until you remove them or close the workspace</td>
          </tr>
          <tr>
            <td>The answers assistants gave, in full</td>
            <td>
              So a figure can be recomputed and checked later. A number nobody can go back and
              verify is a number nobody should act on
            </td>
            <td>While the workspace exists</td>
          </tr>
          <tr>
            <td>Report approvals: the name typed, the time, the report version</td>
            <td>So there is a record that a client signed off on what they actually saw</td>
            <td>While the report exists</td>
          </tr>
          <tr>
            <td>Error reports and security logs</td>
            <td>To find out why something broke and to keep accounts safe</td>
            <td>Short-lived, measured in weeks</td>
          </tr>
        </tbody>
      </table>

      <h3>People inside answers</h3>
      <p>
        We do not ask assistants about people. But an answer about a company sometimes names one —
        a founder, an author, a reviewer. That text is stored as it came back, because editing it
        would make it a different answer. We do not build profiles from it, index it by person, or
        use it to find anything out about anyone.
      </p>

      <h2>Reports and the people who read them</h2>
      <p>
        When your agency sends a report, the person who opens it has no account with us and has
        agreed to nothing. That page carries a plain notice explaining who holds the data behind it
        and how to reach us, without naming the product in a way that would break the report&rsquo;s
        white label.
      </p>
      <p>
        Typing a name to approve a report is a business sign-off between that person and your
        agency, not consent given to us. We record it so both sides can see later what was approved
        and when, and we do nothing else with it.
      </p>
      <p>
        Report links are unguessable and are not indexed by search engines. Anyone with the link can
        open the report, so treat it as you would any document you send by email — and ask your
        agency to revoke it if it goes somewhere it should not.
      </p>

      <h2>What we never do</h2>
      <ul>
        <li>We do not sell data, and we do not share it for anyone else&rsquo;s advertising.</li>
        <li>We do not train models on your data, or let our providers do so.</li>
        <li>
          We do not use one customer&rsquo;s data to improve what another customer sees. There is no
          cross-agency benchmark built from your measurements.
        </li>
        <li>We do not track people across other websites.</li>
      </ul>

      <h2>Who else sees it</h2>
      <p>
        Measuring means sending your questions to assistant providers, and running the product means
        a small number of other services. Every one of them is named, with what it receives, on the{" "}
        <Link href="/legal/subprocessors">sub-processors page</Link>. That list is the complete
        answer; there is no unnamed remainder.
      </p>
      <p>
        We will hand data to an authority when we are legally required to. Where we are allowed to
        tell you first, we will.
      </p>

      <h2>Where it is</h2>
      <p>
        The product runs on infrastructure we operate. The assistant providers and the services
        listed on the sub-processors page are mostly in the United States, so using the product
        means data travelling there. Where that transfer needs a legal mechanism, we use the
        European Commission&rsquo;s standard contractual clauses.
      </p>

      <h2>Cookies</h2>
      <p>
        Signed into the product, one cookie keeps you signed in. That is the only one. The marketing
        site and the client report page set none at all, and there is no advertising or analytics
        cookie anywhere. Details are on the <Link href="/legal/cookies">cookies page</Link>.
      </p>

      <h2>Your rights</h2>
      <p>
        You can ask what we hold about you, ask for it to be corrected, ask for a copy, or ask us to
        delete it. If the data belongs to an agency&rsquo;s workspace rather than to you personally,
        ask that agency first — they decide, and we act on their instruction.
      </p>
      <p>
        {LEGAL_ENTITY ? (
          <>
            Write to <a href={`mailto:${LEGAL_ENTITY.contactEmail}`}>{LEGAL_ENTITY.contactEmail}</a>.
            If you are in the EEA or the UK and we have not resolved something, you may complain to
            your national data protection authority.
          </>
        ) : (
          <>
            Write to <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. If you are in the EEA
            or the UK and we have not resolved something, you may complain to your national data
            protection authority.
          </>
        )}
      </p>

      <h2>Changes</h2>
      <p>
        This page carries a date. When something changes that affects what we do with your data, we
        change the date and tell workspace owners before it takes effect — not after.
      </p>
      <p className="mono">
        Controller for the data described above: {us}.
      </p>
    </>
  );
}
