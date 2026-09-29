import type { Metadata } from "next";
import Link from "next/link";
import { AuthForm } from "@/components/auth-form";
import { MarketingShell } from "@/components/marketing/chrome";

/**
 * Вход в том же обрамлении, что и регистрация.
 *
 * Правой колонки здесь нет намеренно: человек, который возвращается,
 * продукт уже выбрал, и перечислять ему заново, что входит, — шум.
 * Ему нужны два выхода: забытый пароль и регистрация.
 */

export const metadata: Metadata = {
  title: "Sign in · Answertally",
  description: "Sign in to your Answertally workspace.",
};

export default function LoginPage() {
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
              <AuthForm mode="login" />
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
