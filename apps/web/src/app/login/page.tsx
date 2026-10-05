import type { Metadata, Route } from "next";
import Link from "next/link";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/auth-form";
import { MarketingShell } from "@/components/marketing/chrome";
import { auth } from "@/lib/auth";
import { safeNextPath, verificationLinkNotice } from "@/lib/auth-client-messages";

/**
 * Вход в том же обрамлении, что и регистрация.
 *
 * Правой колонки здесь нет намеренно: человек, который возвращается,
 * продукт уже выбрал, и перечислять ему заново, что входит, — шум.
 * Ему нужны два выхода: забытый пароль и регистрация.
 */

export const metadata: Metadata = {
  alternates: { canonical: "/login" },
  robots: { index: false },
  title: "Sign in · Answertally",
  description: "Sign in to your Answertally workspace.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string; reset?: string }>;
}) {
  const { next, error, reset } = await searchParams;
  const target = safeNextPath(next);

  // Сюда же ведёт ссылка подтверждения из письма: по ней человек уже вошёл,
  // и форма входа ему не нужна.
  if (await auth.api.getSession({ headers: await headers() })) {
    redirect(target as Route);
  }

  // Без строки здесь человек не понимал, сработал ли сброс и почему ссылка
  // из письма привела на вход, а не внутрь.
  const notice =
    reset === "done"
      ? "Password updated. Sign in with the new one."
      : error
        ? verificationLinkNotice(error)
        : null;

  return (
    <MarketingShell>
      <div className="wrap">
        <section className="auth-sec">
          <div className="kicker page-kicker">Sign in</div>
          <h1 className="display">
            Welcome <em>back.</em>
          </h1>

          <div className="auth-cols">
            <div className="auth-form">
              {notice && (
                <p role="status" data-testid="login-notice" className="small">
                  {notice}
                </p>
              )}
              <AuthForm mode="login" next={target} />
              <p className="small auth-alt">
                <Link href="/forgot-password">Forgot your password?</Link>
              </p>
              <p className="small auth-alt">
                No account yet? <Link href="/signup">Create your workspace</Link>
              </p>
            </div>
          </div>
        </section>
      </div>
    </MarketingShell>
  );
}
