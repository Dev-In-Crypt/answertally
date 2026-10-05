import Link from "next/link";
import { formatDay } from "@repo/core";
import { LEGAL_ENTITY, LEGAL_LAST_UPDATED } from "@/config/legal";
import { SUPPORT_EMAIL } from "@/config/site";
import { MarketingShell } from "@/components/marketing/chrome";

/**
 * Обрамление юридических страниц.
 *
 * Документы стоят на той же витрине, что и всё остальное: человек,
 * открывший условия из подвала, должен уметь вернуться туда, откуда
 * пришёл, а не упираться в тупик.
 *
 * Шапка страницы говорит две вещи, которые в юридическом тексте обычно
 * приходится искать: когда документ менялся и с кем именно человек имеет
 * дело. Пока юридического лица нет, страница так и говорит — это честнее
 * выдуманного названия, и это видно сразу, а не после подписи.
 */

const DOCS = [
  { href: "/legal/terms", label: "Terms of service" },
  { href: "/legal/privacy", label: "Privacy policy" },
  { href: "/legal/dpa", label: "Data processing" },
  { href: "/legal/subprocessors", label: "Sub-processors" },
  { href: "/legal/cookies", label: "Cookies" },
  { href: "/legal/acceptable-use", label: "Acceptable use" },
  { href: "/legal/refunds", label: "Billing and refunds" },
] as const;

export default function LegalLayout({ children }: { children: React.ReactNode }) {
  return (
    <MarketingShell>
      <div className="wrap">
        <section className="legal-sec">
          <nav className="legal-nav" aria-label="Legal documents">
            {DOCS.map((doc) => (
              <Link key={doc.href} href={doc.href}>
                {doc.label}
              </Link>
            ))}
          </nav>

          <article className="legal-doc">
            {children}

            <footer className="legal-foot">
              <p>
                Last updated <span className="mono">{formatDay(LEGAL_LAST_UPDATED)}</span>.
              </p>
              <p>
                Support and questions about these terms:{" "}
                <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
              </p>
              {/* Реквизиты появятся, когда будут; до того говорим от лица команды. */}
              {LEGAL_ENTITY && (
                <p>
                  {LEGAL_ENTITY.name}
                  {LEGAL_ENTITY.registration ? `, ${LEGAL_ENTITY.registration}` : ""}.{" "}
                  {LEGAL_ENTITY.address}.{" "}
                  <a href={`mailto:${LEGAL_ENTITY.contactEmail}`}>{LEGAL_ENTITY.contactEmail}</a>
                </p>
              )}
            </footer>
          </article>
        </section>
      </div>
    </MarketingShell>
  );
}
