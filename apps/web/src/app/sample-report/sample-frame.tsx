import Link from "next/link";
import type { ReportPayload } from "@repo/core";
import { SAMPLE_AGENCY } from "@repo/core";
import { ReportView } from "@/components/report-view";
import { MarketingFooter, MarketingHeader } from "@/components/marketing/chrome";

/**
 * Обрамление публичного примера.
 *
 * Всё, что нужно витрине — пояснение, переключатель, призыв к действию, —
 * живёт вокруг `ReportView`, а не внутри него: компонент обязан оставаться
 * ровно тем документом, который получает клиент агентства. Любой пропс вида
 * `variant` или `showBanner` протёк бы отсюда на `/r/[token]` и в PDF.
 *
 * Поэтому и стиль витрины у обрамления свой: каждый его кусок — отдельный
 * корень `data-surface="marketing"`, а отчёт между ними остаётся в своём
 * `data-surface="report"` и не получает ни шрифтов, ни цветов сайта.
 */

export function SampleFrame({
  payload,
  variant,
}: {
  payload: ReportPayload;
  variant: "delivery" | "audit";
}) {
  return (
    <>
      <MarketingHeader active="sample" />

      <div data-surface="marketing" className="mk sample-banner">
        <div className="wrap">
          <p data-testid="sample-report-notice">
            Fictional agency, fictional client, invented numbers. The layout and the wording are the
            ones your client receives: this page renders the same component the product does.
          </p>

          <nav data-testid="sample-report-switch" className="sample-switch" aria-label="Example reports">
            <SwitchLink href="/sample-report" active={variant === "delivery"}>
              Quarterly retainer report
            </SwitchLink>
            <SwitchLink href="/sample-report/audit" active={variant === "audit"}>
              Free audit report
            </SwitchLink>
          </nav>
        </div>
      </div>

      <main>
        <ReportView payload={payload} agency={SAMPLE_AGENCY} approved={null} />
      </main>

      <div data-surface="marketing" className="mk sample-cta">
        <div className="wrap">
          <h2 className="h3">Run this for a brand you work on</h2>
          <p className="prose">
            The free audit asks ChatGPT and Perplexity your client’s buyer questions, several
            times each, and ends on a page like this one, in your agency’s brand.
          </p>
          <div className="ctas">
            <Link className="btn primary" href="/signup">
              Start a free audit
            </Link>
            <Link className="link" href="/free-audit">
              How the free audit works →
            </Link>
            <Link className="link" href="/method">
              How we measure →
            </Link>
          </div>
        </div>
      </div>

      <MarketingFooter />
    </>
  );
}

function SwitchLink({
  href,
  active,
  children,
}: {
  href: "/sample-report" | "/sample-report/audit";
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link href={href} aria-current={active ? "page" : undefined}>
      {children}
    </Link>
  );
}
