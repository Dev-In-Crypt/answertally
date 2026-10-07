import type { Metadata } from "next";
import Link from "next/link";
import { adVendors, TRACKING_ENABLED, UMAMI } from "@/config/tracking";

/**
 * Уведомление о куках.
 *
 * Страницей, а не полосой согласия — и это не экономия, а следствие того,
 * что продукт действительно делает. Проверено в браузере: на витрине куки
 * не ставятся вовсе, на странице клиентского отчёта тоже, а внутри
 * продукта стоит одна — сессия. Тема и настройки экранов лежат не в
 * куках, а в локальном хранилище браузера и никуда не уходят.
 *
 * Полоса «мы используем куки» над страницей, которая их не ставит, —
 * это не осторожность. Это ещё один баннер, который человек закрывает не
 * читая, и он приучает закрывать не читая те баннеры, где выбор
 * действительно есть. Если появится аналитика или что-то ещё
 * необязательное, согласие понадобится по-настоящему — и вот тогда
 * полоса будет честной.
 */

export const metadata: Metadata = {
  alternates: { canonical: "/legal/cookies" },
  title: "Cookies · Answertally",
  description: "What Answertally stores in your browser. It is less than you expect.",
};

export default function CookiesPage() {
  return (
    <>
      <h1>Cookies</h1>
      {TRACKING_ENABLED ? (
        <>
          <p className="lede">
            Nothing optional runs until you choose. This page says exactly what is stored and when.
          </p>

          <h2>The marketing site</h2>
          <p>
            A banner asks whether we may load ad-measurement tags from {adVendors().join(", ")}.
            They tell us which ads bring people to this site and let those platforms measure their
            own ads. If you choose <strong>Reject all</strong>, or do not choose, none of them load
            and nothing is stored. If you choose <strong>Accept all</strong>, they load and set
            their own cookies, which we do not control; each platform describes them in its own
            privacy policy. You can change the choice at any time with{" "}
            <strong>Cookie settings</strong> in the footer. Withdrawing takes effect when the page
            reloads.
          </p>
          <p>
            What we send on accept is a page view on each page you open and one event when you
            create an account. No names, emails or report contents are sent.
          </p>
        </>
      ) : (
        <>
          <p className="lede">
            There is no cookie banner here because there is nothing to ask you about. This page says
            exactly what is stored and when.
          </p>

          <h2>The marketing site</h2>
          <p>
            Reading this site sets no cookies at all. No cookie-based analytics, no advertising, no third-party
            scripts that set their own. You can check in your browser rather than taking our word
            for it.
          </p>
        </>
      )}

      <h2>The client report page</h2>
      <p>
        A report opened from a link your agency sent sets nothing either. That page is deliberately
        plain: it exists to be read and approved, and the less that runs on it the fewer reasons
        there are to distrust it.
      </p>

      <h2>Signed into the product</h2>
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
            <td>Session cookie</td>
            <td>Keeps you signed in between pages. Without it you would log in on every click</td>
            <td>Until you sign out or it expires</td>
          </tr>
        </tbody>
      </table>
      <p>
        That is the whole list. It is strictly necessary for the thing you asked for (being signed
        in), so there is no consent to give or withhold. Refusing it means not signing in.
      </p>

      <h2>Not cookies, but worth naming</h2>
      <p>
        Small preferences live in your browser&rsquo;s local storage rather than in a cookie:
        whether you chose the dark theme, how you last grouped the dashboard
        {TRACKING_ENABLED ? ", and your answer to the cookie banner" : ""}. They stay in that
        browser, are never sent to us, and disappear when you clear site data.
      </p>

      {UMAMI.websiteId && (
        <>
          <h2>Visit statistics</h2>
          <p>
            We count visits with Umami, which we run on our own server at stats.answertally.com. It
            sets no cookies and stores nothing in your browser. It records the page, the referring
            site, the country and the kind of device, plus a few steps such as creating an account,
            and nothing that identifies you. That is why it runs without asking.
          </p>
        </>
      )}

      <h2>If this changes</h2>
      <p>
        If we add anything else optional (analytics, a support widget, anything that watches what
        you do), this page will say what it is before it runs, and it will load only after you
        accept it in the banner. You can change your choice any time under Cookie settings in the
        footer.
      </p>
      <p>
        What is stored on our side, rather than in your browser, is in the{" "}
        <Link href="/legal/privacy">privacy policy</Link>.
      </p>
    </>
  );
}
