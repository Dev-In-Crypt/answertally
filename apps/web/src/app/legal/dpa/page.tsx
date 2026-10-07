import type { Metadata } from "next";
import Link from "next/link";
import { SUBPROCESSOR_NOTICE_DAYS } from "@/config/legal";

/**
 * Условия обработки данных.
 *
 * Публичной страницей, а не файлом по запросу: у большинства конкурентов
 * этот документ либо за формой, либо его нет, и агентство, которое должно
 * ответить своему клиенту «а кто обрабатывает его данные», остаётся ни с
 * чем. Открытая страница снимает этот вопрос до разговора о продаже.
 *
 * Главное отличие от шаблона — пункт про третью сторону: клиент агентства
 * не подписывал ничего, но его данные мы держим и отчёт ему показываем.
 */

export const metadata: Metadata = {
  alternates: { canonical: "/legal/dpa" },
  title: "Data processing terms · Answertally",
  description:
    "How responsibility for your clients' data splits between your agency and Answertally.",
};

export default function DpaPage() {
  return (
    <>
      <h1>Data processing terms</h1>
      <p className="lede">
        These terms apply whenever we handle data on your behalf. They form part of the{" "}
        <Link href="/legal/terms">terms of service</Link> and apply automatically. You do not need
        to ask for them or sign anything separate.
      </p>

      <h2>1. Who does what</h2>
      <p>
        For the material in your workspace (the brands you measure, the questions you ask, the
        answers that come back, the reports you produce and who you send them to), you decide and we
        carry out. In data protection terms you are the controller and we are the processor.
      </p>
      <p>
        For the data that makes the service exist (team accounts, billing, security logs, error
        reports), we decide, and the <Link href="/legal/privacy">privacy policy</Link> is the notice
        for it.
      </p>
      <p>
        We do not step outside the processor role for your workspace data. If we ever wanted to use
        it for something of our own, such as a benchmark across agencies or an improvement to the parser
        trained on real answers, that would make us a controller, and we would have to ask you
        first. We have not, and the product is built so that we do not need to.
      </p>

      <h2>2. What we process, and for whom</h2>
      <table>
        <thead>
          <tr>
            <th scope="col">Subject</th>
            <th scope="col">What it covers</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>Purpose</td>
            <td>Measuring brand visibility in AI assistant answers and producing reports on it</td>
          </tr>
          <tr>
            <td>Duration</td>
            <td>For as long as your workspace exists, plus the deletion window in section 7</td>
          </tr>
          <tr>
            <td>Categories of data</td>
            <td>
              Mostly company information: brand names, competitor names, domains, questions, and
              the answers assistants gave. Personal data appears as the contact details of the
              people you invite, the name and time recorded when a client approves a report, and
              any names that happen to appear inside an assistant&rsquo;s answer
            </td>
          </tr>
          <tr>
            <td>Categories of people</td>
            <td>Your staff, and the client contacts you choose to send reports to</td>
          </tr>
          <tr>
            <td>Special categories</td>
            <td>None. The product is not built to process them and must not be used to</td>
          </tr>
        </tbody>
      </table>

      <h2>3. Our obligations</h2>
      <ul>
        <li>
          We process your workspace data only on your instructions. Using the product is the
          instruction; there is no separate channel we act on.
        </li>
        <li>
          Everyone with access is bound to confidentiality, and access is limited to those who need
          it to run the service or to help you when you ask.
        </li>
        <li>
          We keep appropriate security measures: data encrypted in transit, tenancy separation
          enforced in code on every request rather than by convention, and secrets kept out of logs
          and error reports.
        </li>
        <li>
          We help you meet your own obligations: answering a person who asks what is held, and
          giving you what you need if you have to report a breach.
        </li>
        <li>
          If we become aware of a breach affecting your data, we tell you without undue delay and
          in any case within 48 hours, with what we know, rather than waiting until the picture is
          complete.
        </li>
      </ul>

      <h2>4. Sub-processors</h2>
      <p>
        You authorise the sub-processors listed on the{" "}
        <Link href="/legal/subprocessors">sub-processors page</Link>. That list is public and dated,
        and it is the whole list.
      </p>
      <p>
        We give at least {SUBPROCESSOR_NOTICE_DAYS} days&rsquo; notice on that page before adding
        one or changing what one receives, so you can object. If you object on reasonable grounds
        and we cannot offer an alternative, you may end the agreement for the affected part without
        penalty.
      </p>
      <p>
        Every sub-processor is bound to obligations no weaker than these, and we remain answerable
        to you for what they do.
      </p>

      <h2>5. The person who never signed anything</h2>
      <p>
        A client of yours receives a report link, opens it without an account, and may approve it by
        typing their name. They have no agreement with us, and they did not give us their data;
        you did.
      </p>
      <p>Because of that, three things apply, and they are ours to get right:</p>
      <ul>
        <li>
          That page carries a plain notice saying whose data it shows, who holds it and how to reach
          us. It does so without breaking the report&rsquo;s white label.
        </li>
        <li>
          Approving is a sign-off between them and you, not consent given to us. We record the name,
          the time, the report version and the exact wording they were shown, so neither side has to
          rely on memory about what was approved.
        </li>
        <li>
          A link can be revoked and can expire. If a report reaches someone it should not have, tell
          us and we will cut the link off.
        </li>
      </ul>

      <h2>6. International transfers</h2>
      <p>
        The assistant providers and the services we use are largely in the United States, so using
        the product involves transferring data there. Where a legal mechanism is needed we rely on
        the European Commission&rsquo;s standard contractual clauses (Module 3, processor to
        processor, for our sub-processors), and these terms incorporate them.
      </p>

      <h2>7. Deletion, and the one exception</h2>
      <p>
        When you close a workspace or end the agreement, we delete your workspace data within 30
        days, except where we are required to keep something (billing records for tax, for example).
      </p>
      <p>
        One exception is deliberate and worth stating plainly, because most templates promise the
        opposite. While a workspace is open we keep the raw answers assistants gave, in full, for as
        long as the workspace exists. Every figure the product shows is derived from them, and
        without them an old number could never be recomputed when the parser improves, or checked
        when someone disputes it. They are deleted with the workspace like everything else, but
        they are not deleted while it is open, and no retention setting will do it, because that
        would leave figures on screen that nothing supports.
      </p>
      <p>
        If that does not work for you, say so before you buy rather than after: it is a property of
        how the product is built, not a setting.
      </p>

      <h2>8. Audit</h2>
      <p>
        You may ask us for the information you need to show that we are meeting these terms, and we
        will provide it. For an on-site audit, ask and we will agree a reasonable scope and time.
        We would rather answer questions than have you take our word for it.
      </p>
    </>
  );
}
