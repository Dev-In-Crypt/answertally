import type { Metadata } from "next";
import Link from "next/link";
import { SUBPROCESSOR_NOTICE_DAYS } from "@/config/legal";

/**
 * Список субподрядчиков — публично и с датой.
 *
 * У конкурентов этот список либо спрятан в приложении к договору, либо
 * его нет вовсе. Держать его открытой страницей дёшево и снимает главный
 * вопрос агентства, которое отвечает перед своим клиентом: где лежат его
 * данные и кто их видит.
 *
 * Правило страницы: здесь только те, кто действительно получает данные.
 * Список, в который «на всякий случай» вписали неиспользуемое, — это не
 * осторожность, а шум, по которому нельзя проверить ни одного утверждения.
 */

export const metadata: Metadata = {
  alternates: { canonical: "/legal/subprocessors" },
  title: "Sub-processors · Answertally",
  description:
    "Every third party that can receive data when you use Answertally, what it receives, and why.",
};

interface Row {
  name: string;
  purpose: string;
  data: string;
  where: string;
}

/** Ассистенты: им уходит сам вопрос и название измеряемого бренда. */
const ASSISTANT_ROWS: Row[] = [
  {
    name: "OpenAI",
    purpose: "Answers the tracked questions as ChatGPT",
    data: "The question text and the brand and competitor names in it",
    where: "United States",
  },
  {
    name: "Perplexity",
    purpose: "Answers the tracked questions",
    data: "The question text and the brand and competitor names in it",
    where: "United States",
  },
  {
    name: "Anthropic",
    purpose: "Answers the tracked questions as Claude, when switched on for a client",
    data: "The question text and the brand and competitor names in it",
    where: "United States",
  },
  {
    name: "xAI",
    purpose: "Answers the tracked questions as Grok",
    data: "The question text and the brand and competitor names in it",
    where: "United States",
  },
];

/** Остальное: платежи, почта, сбор ошибок. */
const SERVICE_ROWS: Row[] = [
  {
    name: "Hetzner Online GmbH",
    purpose: "Hosts the product and its database",
    data: "Everything stored in your workspace: clients, questions, answers, reports, uploaded logos",
    where: "Germany (European Union)",
  },
  {
    name: "Cloudflare",
    purpose: "Handles our domain and forwards mail sent to our support address",
    data: "Messages you send to our support address, in transit",
    where: "United States (global network)",
  },
  {
    name: "Creem (Armitage Labs OÜ)",
    purpose:
      "Sells the plans to you as merchant of record: takes payment, charges sales tax and issues invoices",
    data: "Billing contact and payment details, which are entered on Creem and never reach us",
    where: "Estonia (European Union)",
  },
  {
    name: "Resend",
    purpose: "Delivers product email — invitations, password resets, report links",
    data: "Recipient address, subject and message body",
    where: "United States",
  },
  {
    name: "Sentry",
    purpose: "Receives error reports from the product",
    data: "Technical details of a failure. Secrets, tokens, request bodies and cookies are stripped before sending, and the report page never sends anything at all",
    where: "United States",
  },
];

function Table({ rows, caption }: { rows: Row[]; caption: string }) {
  return (
    <table>
      <caption className="sr-only">{caption}</caption>
      <thead>
        <tr>
          <th scope="col">Who</th>
          <th scope="col">What for</th>
          <th scope="col">What they get</th>
          <th scope="col">Where</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.name}>
            <td>{row.name}</td>
            <td>{row.purpose}</td>
            <td>{row.data}</td>
            <td>{row.where}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function SubprocessorsPage() {
  return (
    <>
      <h1>Sub-processors</h1>
      <p className="lede">
        Everyone outside our own systems who can receive data when you use Answertally. Nobody else
        does.
      </p>

      <h2>Assistants we ask on your behalf</h2>
      <p>
        Measuring means asking assistants the questions you set. Those questions travel to the
        assistant, and they contain the brand and competitor names you are tracking. That is the
        whole point of the product, and it is the part worth being precise about: what leaves us is
        the question, not your client&rsquo;s account, contacts or files.
      </p>
      <p>
        Which assistants are asked depends on your plan: the free audit asks ChatGPT and
        Perplexity; paid plans add Grok, and Claude from the Growth plan. Claude can be switched
        off per client, and an assistant that is switched off receives nothing.
      </p>
      <Table rows={ASSISTANT_ROWS} caption="Assistant providers we send tracked questions to" />

      <h2>Running the product</h2>
      <Table rows={SERVICE_ROWS} caption="Service providers used to run the product" />

      <h2>What none of them get</h2>
      <ul>
        <li>We do not sell data to anyone, and none of these providers receive data for their own purposes.</li>
        <li>
          We do not send your data, or your clients&rsquo; data, to be used for training models. The
          assistants answer our questions; they do not receive your workspace.
        </li>
        <li>
          Reports are not sent anywhere by us. A report reaches a client when you send the link, and
          not before.
        </li>
      </ul>

      <h2>Changes</h2>
      <p>
        This page carries a date, and it is the record. If we add a sub-processor or change what one
        receives, this page is updated at least {SUBPROCESSOR_NOTICE_DAYS} days before the change
        takes effect, so that you have time to object or leave.
      </p>
      <p>
        We may replace a sub-processor sooner than that when the alternative is an outage or a
        security problem. If that happens, the page says so and gives the date it actually changed.
      </p>

      <h2>Hosting</h2>
      <p>
        The product runs on infrastructure we operate, with the database and stored answers on
        machines we control. When that hosting provider is fixed, it is named here with the rest.
      </p>

      <p>
        How the responsibilities split between you and us is set out in the{" "}
        <Link href="/legal/dpa">data processing terms</Link>.
      </p>
    </>
  );
}
