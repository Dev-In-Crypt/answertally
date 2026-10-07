import Link from "next/link";
import { MARKETING_COPY } from "@repo/core";
import { SUPPORT_EMAIL } from "@/config/site";
import { AccountLink } from "./account-link";
import { ConsentManager, CookieSettingsLink } from "./consent";
import { Wordmark } from "./logo";
import "./marketing.css";

/**
 * Шапка и подвал витрины: /, /product, /pricing, /free-audit и примеры отчёта.
 *
 * Внутри самого отчёта их быть не может — там бренд агентства и ноль следов
 * продукта (инвариант 3), поэтому обрамление всегда снаружи `ReportView`, а
 * каждый кусок обрамления — свой корень `.mk`: стили витрины не достают до
 * отчёта, стоящего между ними.
 *
 * Мобильное меню — `<details>`: открывается без JavaScript, и шапке не нужен
 * клиентский компонент.
 */

export type MarketingSection = "product" | "method" | "sample" | "pricing" | "audit";

const NAV = [
  { id: "product", label: "Product", href: "/product" },
  { id: "method", label: "Method", href: "/method" },
  { id: "sample", label: "Sample report", href: "/sample-report" },
  { id: "pricing", label: "Pricing", href: "/pricing" },
  { id: "audit", label: "Free audit", href: "/free-audit" },
] as const;

function NavLinks({ active }: { active?: MarketingSection }) {
  return NAV.map((item) => (
    <Link key={item.id} href={item.href} aria-current={item.id === active ? "page" : undefined}>
      {item.label}
    </Link>
  ));
}

export function MarketingHeader({ active }: { active?: MarketingSection }) {
  return (
    <header data-surface="marketing" className="mk site-head" data-testid="marketing-header">
      <div className="wrap">
        <Link className="brand" href="/" aria-label="Answertally home">
          <Wordmark />
        </Link>
        <nav className="nav" aria-label="Main">
          <NavLinks active={active} />
        </nav>
        <div className="head-right">
          <AccountLink className="signin" />
          <Link className="btn primary sm" href="/signup" data-testid="header-cta">
            <span className="cta-long">Run a free audit</span>
            <span className="cta-short">Free audit</span>
          </Link>
          <details className="menu" data-testid="mobile-menu">
            <summary aria-label="Menu">
              <svg width="18" height="14" viewBox="0 0 18 14" aria-hidden>
                <path d="M1 1h16M1 7h16M1 13h16" stroke="#15171C" strokeWidth="1.6" strokeLinecap="round" />
              </svg>
            </summary>
            <nav className="panel" aria-label="Main, compact">
              <NavLinks active={active} />
              <AccountLink />
            </nav>
          </details>
        </div>
      </div>
    </header>
  );
}

export function MarketingFooter() {
  return (
    <footer data-surface="marketing" className="mk site-foot">
      <div className="wrap">
        <div className="foot-top">
          <div className="foot-brand">
            <Wordmark dot="#7C86FF" />
            <p>
              AI visibility measurement, diagnosis and white-label reporting for agencies.
              Measures ChatGPT, Perplexity, Grok and Claude; which of them a workspace can
              switch on depends on its plan.
            </p>
          </div>
          <div className="foot-col">
            <h2>Product</h2>
            <ul>
              <li><Link href="/product#measure">Measure</Link></li>
              <li><Link href="/product#diagnose">Diagnose</Link></li>
              <li><Link href="/product#act">Opportunities</Link></li>
              <li><Link href="/product#experiments">Experiments</Link></li>
              <li><Link href="/product#reports">Reports</Link></li>
              <li><Link href="/product#api">API</Link></li>
            </ul>
          </div>
          <div className="foot-col">
            <h2>Start</h2>
            <ul>
              <li><Link href="/free-audit">Free audit</Link></li>
              <li><Link href="/sample-report">Sample report</Link></li>
              <li><Link href="/pricing">Pricing</Link></li>
              <li><AccountLink /></li>
            </ul>
          </div>
          <div className="foot-col">
            <h2>Method</h2>
            <ul>
              <li><Link href="/method">How we measure</Link></li>
              <li><Link href="/method#confidence">What confidence means</Link></li>
              <li><Link href="/method#never">What we never claim</Link></li>
              <li><Link href="/sample-report/audit">Sample audit report</Link></li>
            </ul>
          </div>
          {/*
            Три страницы, до которых иначе не дойти: в шапке им места нет, а
            без ссылки страница существует только для того, кто знает адрес.
          */}
          <div className="foot-col">
            <h2>For agencies</h2>
            <ul>
              <li><Link href="/partners">Selling it to clients</Link></li>
              <li><Link href="/proposal-template">Proposal template</Link></li>
              <li><Link href="/compare">Compared with Peec, Otterly and others</Link></li>
              <li><Link href="/research">Our study (in progress)</Link></li>
            </ul>
          </div>
        </div>
        <div className="foot-small">
          <span>{MARKETING_COPY.siteBasis}</span>
          {/*
            Юридические страницы стоят в подвале, а не отдельным разделом
            в шапке: их ищут именно здесь, и вести их в навигацию значило
            бы занимать место, нужное продукту.
          */}
          <span className="foot-legal">
            <Link href="/legal/terms">Terms</Link>
            <Link href="/legal/refunds">Billing and refunds</Link>
            <Link href="/legal/privacy">Privacy</Link>
            <Link href="/legal/dpa">Data processing</Link>
            <Link href="/legal/subprocessors">Sub-processors</Link>
            <Link href="/legal/cookies">Cookies</Link>
            <CookieSettingsLink />
            <Link href="/legal/acceptable-use">Acceptable use</Link>
            <a href={`mailto:${SUPPORT_EMAIL}`} data-testid="support-email">
              {SUPPORT_EMAIL}
            </a>
          </span>
          <span>© 2026 Answertally</span>
        </div>
      </div>
    </footer>
  );
}

/** Страница витрины целиком: шапка, содержимое, подвал. */
export function MarketingShell({
  active,
  children,
}: {
  active?: MarketingSection;
  children: React.ReactNode;
}) {
  return (
    <>
      <MarketingHeader active={active} />
      <main data-surface="marketing" className="mk">
        {children}
      </main>
      <MarketingFooter />
      <ConsentManager />
    </>
  );
}
