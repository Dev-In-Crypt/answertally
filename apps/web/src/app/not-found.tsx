import type { Metadata } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { MarketingShell } from "@/components/marketing/chrome";
import { REPORT_HOST } from "@/config/site";

export const metadata: Metadata = {
  title: "Page not found",
};

/**
 * 404 в обрамлении витрины, с дорогой назад: на старую или опечатанную
 * ссылку из рекламы попадают люди, которых иначе встретила бы голая
 * страница Next.
 *
 * На домене отчётов агентства (`NEXT_PUBLIC_REPORT_HOST`) — та же весть без
 * следа продукта: туда заходит клиент агентства (инвариант 3). Остальные
 * адреса на этом домене middleware отсекает сам.
 */
export default async function NotFound() {
  const requestHeaders = await headers();
  const host = (requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "")
    .split(":")[0]
    ?.toLowerCase();

  if (REPORT_HOST && host === REPORT_HOST.toLowerCase()) {
    return (
      <main className="mx-auto flex min-h-[60vh] max-w-md flex-col justify-center gap-3 px-6 py-16">
        <h1 className="text-2xl font-semibold tracking-tight">Page not found</h1>
        <p className="text-sm text-muted-foreground">
          Check the link you were sent, or ask the person who shared it for a new one.
        </p>
      </main>
    );
  }

  return (
    <MarketingShell>
      <div className="wrap">
        <section className="auth-sec">
          <div className="kicker page-kicker">404</div>
          <h1 className="display">
            This page <em>does not exist.</em>
          </h1>
          <p className="lead" style={{ marginTop: 22, maxWidth: 560 }}>
            The link may be old or mistyped. Start from the home page, or sign in to your workspace.
          </p>
          <div className="ctas" style={{ marginTop: 32 }}>
            <Link className="btn primary" href="/">
              Go to the home page
            </Link>
            <Link className="btn secondary" href="/pricing">
              Pricing
            </Link>
            <Link className="btn secondary" href="/login">
              Sign in
            </Link>
          </div>
        </section>
      </div>
    </MarketingShell>
  );
}
