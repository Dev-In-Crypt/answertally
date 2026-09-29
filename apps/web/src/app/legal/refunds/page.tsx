import type { Metadata } from "next";
import Link from "next/link";
import { FREE_CHECK_ALLOWANCE } from "@repo/core";

/**
 * Условия оплаты, отмены и возврата.
 *
 * Отдельной страницей, потому что это первое, что читает покупатель,
 * сравнивающий нас с соседями, и потому что Stripe ждёт, чтобы правила
 * возврата были опубликованы до покупки.
 *
 * Позиция: бесплатный аудит показывает продукт целиком до денег, поэтому
 * возврат «я не посмотрел, что покупаю» не нужен — и обещать его значило
 * бы обещать то, чего мы не собираемся делать. Но и «не возвращаем
 * никогда» мы не пишем: если сломались мы, это наш счёт.
 */

export const metadata: Metadata = {
  title: "Billing and refunds · Answertally",
  description: "How billing works, how to cancel, and when money comes back.",
};

export default function RefundsPage() {
  return (
    <>
      <h1>Billing and refunds</h1>
      <p className="lede">
        Short version: try the whole product free before you pay, cancel whenever you like, and the
        month you have started is the month you pay for.
      </p>

      <h2>Before you pay</h2>
      <p>
        The free audit runs the product end to end on one brand — {FREE_CHECK_ALLOWANCE} AI checks,
        the full diagnosis, the ranked work and a report you can send. No card is asked for.
      </p>
      <p>
        This is deliberate, and it is why the rest of this page is not generous about refunds:
        nobody should have to buy a plan to find out what the product does.
      </p>

      <h2>How billing works</h2>
      <ul>
        <li>Plans are monthly and paid in advance. The month starts when you subscribe.</li>
        <li>Payment is taken by Stripe. We never see or hold your card.</li>
        <li>
          Moving up a plan takes effect at once, and you pay the difference for the rest of the
          month immediately — the new limits are available the same day.
        </li>
        <li>
          Moving down takes effect the same way. If you have more client accounts than the smaller
          plan holds, the product will not let the change through until you archive the extras —
          nothing is deleted for you.
        </li>
      </ul>

      <h2>Cancelling</h2>
      <p>
        Cancel in the product, whenever you like. No notice period and no exit call: the
        subscription runs to the end of the month you have already paid for, and then stops.
      </p>
      <p>
        Until it stops, everything keeps working — including the report links your clients already
        have. Cancelling does not cut off a report you sent last week.
      </p>
      <p>
        After it stops, you can still sign in and read what was measured. What stops is new
        measurement. If you want your data out, export it or ask us before you close the workspace;
        what happens to it afterwards is in the{" "}
        <Link href="/legal/dpa">data processing terms</Link>.
      </p>

      <h2>Refunds</h2>
      <p>
        We do not refund a month that has started, because the free audit exists so that you can
        decide before that month begins.
      </p>
      <p>Two exceptions, and we apply them without argument:</p>
      <ul>
        <li>
          <strong>We charged you wrongly.</strong> Double charge, a plan you did not choose, billing
          after you cancelled — we refund it in full.
        </li>
        <li>
          <strong>The product did not work.</strong> If measurement was broken for a meaningful part
          of a month and that is on us, tell us and we will refund or credit that part. We would
          rather do that than have you argue with your bank.
        </li>
      </ul>
      <p>
        We do not refund because an assistant stopped naming a client, because a figure went down,
        or because the work a report recommended was not done. Those are outcomes, and the product
        never promised them.
      </p>

      <h2>Failed payments</h2>
      <p>
        A card that expires or a payment a bank rejects does not switch you off that day. There is a
        grace period, the product tells you what happened, and your clients&rsquo; report links keep
        working throughout it. After the grace period runs out without payment, measurement stops —
        stored data is not deleted.
      </p>

      <h2>Invoices and tax</h2>
      <p>
        Every payment produces an invoice you can download from the billing screen. Prices are shown
        before tax; any tax due is added at checkout based on where your business is.
      </p>

      <h2>Questions about a charge</h2>
      <p>
        Ask us before you raise a chargeback. A chargeback suspends the workspace automatically and
        takes weeks to unwind; an email usually takes a day.
      </p>
    </>
  );
}
