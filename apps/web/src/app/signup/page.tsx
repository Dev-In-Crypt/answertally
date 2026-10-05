import type { Metadata } from "next";
import Link from "next/link";
import { MARKETING_COPY } from "@repo/core";
import { freeAuditAssistantSentence } from "@repo/core/adapters/capacity";
import { AuthForm } from "@/components/auth-form";
import { MarketingShell } from "@/components/marketing/chrome";

/**
 * Регистрация в оформлении витрины.
 *
 * Раньше экран стоял голым посреди тёмного поля: ни шапки, ни выхода —
 * человек, попавший сюда с главной, мог только вернуться назад браузером.
 * Регистрация — часть витрины, а не отдельное приложение, поэтому и
 * обрамление у неё то же: шапка со всеми разделами и подвал.
 *
 * Рядом с формой — что именно человек получит, бесплатно и без карты.
 * Это не украшение: до этого экрана он читал обещания, и здесь последний
 * момент, когда они должны совпасть с тем, что произойдёт дальше.
 */

export const metadata: Metadata = {
  alternates: { canonical: "/signup" },
  title: "Create your workspace · Answertally",
  description: "Run the free audit on one brand on ChatGPT and Perplexity. No card.",
};

/**
 * Ассистенты, которых получит новый аккаунт. Регистрация заводит агентство
 * на starter, и называть здесь общую тройку значило бы пообещать лишнее.
 */
const DEFAULT_ASSISTANTS = freeAuditAssistantSentence();

const INCLUDED = [
  "One full audit on one brand, free",
  `${DEFAULT_ASSISTANTS}, every question asked several times`,
  "The report in your brand, not ours",
  MARKETING_COPY.limits.nothingPublished,
];

export default function SignupPage() {
  return (
    <MarketingShell>
      <div className="wrap">
        <section className="auth-sec">
          <div className="kicker page-kicker">Free audit</div>
          <h1 className="display">
            Create your <em>workspace.</em>
          </h1>
          <p className="lead auth-lead">
            Run the free audit on one brand, read the whole report, then decide. No card is asked
            for, and nothing is charged to run it.
          </p>

          <div className="auth-cols">
            <div className="auth-form">
              <AuthForm mode="signup" />
              <p className="small auth-alt">
                Already have an account? <Link href="/login">Sign in</Link>
              </p>
            </div>

            <ul className="auth-included">
              {INCLUDED.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </MarketingShell>
  );
}
