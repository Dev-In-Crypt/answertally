import type { Metadata } from "next";
import Link from "next/link";
import { MARKETING_COPY, REPORT_COPY, SAMPLE_AUDIT_REPORT } from "@repo/core";
import { freeAuditAssistantSentence } from "@repo/core/adapters/capacity";
import { CtaNote, Faq, MethodLink, SecHead, TalkLink } from "@/components/marketing/bits";
import { MarketingShell } from "@/components/marketing/chrome";
import { AUDIT_STEPS, checkoutCopy } from "@/components/marketing/content";
import { getPaymentProvider } from "@/server/payments";
import { ReportPreview } from "@/components/marketing/report-preview";
import { QuestionPreview } from "@/components/marketing/question-preview";
import { captchaSiteKey } from "@/server/captcha";

/**
 * Бесплатный аудит — главный вход в продукт.
 *
 * Пример результата стоит в первом экране, рядом с кнопкой: агентство видит,
 * что получит, до регистрации. Карточка собрана из того же примера аудита,
 * что и /sample-report/audit, и повторяет настоящий отчёт: доля клиента,
 * средняя по конкурентам (долей каждого конкурента в отчёте нет), работы с
 * причинами, предложенный ретейнер. Маржа агентства сюда не выводится.
 *
 * Срок не обещается и «мгновенно» не говорится: каждый вопрос спрашивается
 * несколько раз, и время зависит от числа вопросов.
 */

/**
 * Что спрашивает бесплатный аудит.
 *
 * Регистрация заводит агентство на starter, поэтому здесь именно его
 * тройка, а не общая: назвать её литералом
 * значило бы пообещать ассистента, которого на этом тарифе нет.
 */
const FREE_TRIO = freeAuditAssistantSentence();

// Признак оплаты — из env рантайма, а не сборки (см. /pricing).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  alternates: { canonical: "/free-audit" },
  title: "Free AI Visibility Audit for Your Client · Answertally",
  description:
    `Audit a brand for free: what ${FREE_TRIO} say about it, which sources they cite, ranked work with reasons, and a report in your brand.`,
};

function faqItems(paymentsOn: boolean) {
  return [
  {
    q: "How long does it take?",
    a: `Usually minutes rather than seconds; it depends on how fast the assistants answer that day. ${MARKETING_COPY.auditTakesTime} We email you when the results are ready, so you do not have to wait on the page.`,
  },
  {
    q: "Which assistants does the audit use?",
    a: `${FREE_TRIO}, each with its own cited sources. Paid plans measure ChatGPT too, and can switch on Google AI Mode on any plan and Grok from Growth, per client.`,
  },
  {
    q: "What happens right after the audit?",
    a: "You read the diagnosis and the ranked work in your workspace, adjust the proposed engagement, and generate the report. It goes nowhere until you send it. If the client signs, you keep measuring them in the same workspace without setting anything up again.",
  },
  {
    q: "What if we want to keep measuring the client?",
    a: (
      <>
        Ongoing measurement is what the plans cover. {checkoutCopy(paymentsOn).note}{" "}
        <Link href="/pricing">See pricing</Link>.
      </>
    ),
  },
  ];
}

export default function FreeAuditPage() {
  // Признак тот же, что рисует кнопку оплаты в продукте.
  const paymentsOn = getPaymentProvider().configured;

  return (
    <MarketingShell active="audit">
      <div className="wrap">
        <section className="fa-hero">
          <div>
            <div className="kicker page-kicker">Free audit</div>
            <h1 className="display">
              Audit a client, or a prospect you are pitching, <em>for free.</em>
            </h1>
            <p className="lead">
              See what {FREE_TRIO} say about a brand and its competitors, which
              sources they cite, and what to work on first, as a report in your brand you can take
              into the next client meeting.
            </p>
            <div className="ctas">
              <Link className="btn primary" href="/signup" data-testid="audit-cta">
                Run a free audit
              </Link>
              <a className="link" href="#questions">
                Preview the questions first, no account ↓
              </a>
              <TalkLink />
            </div>
            <CtaNote />
            <ul className="fa-facts">
              <li>Free to run, and no card is asked for</li>
              <li>Nothing is published anywhere</li>
              <li>The report is yours to send, or not</li>
            </ul>
          </div>
          <div className="wl-stage">
            <ReportPreview
              payload={SAMPLE_AUDIT_REPORT}
              variant="audit"
              testId="audit-report"
              ariaLabel="Example white-label audit report, abridged"
              hint="Sample output, in an agency’s brand"
              initial={1}
            />
          </div>
        </section>
      </div>

      {/* 0 · вопросы без регистрации: приманка, не тратит проверок */}
      <section className="sec" id="questions">
        <div className="wrap">
          <SecHead n={1} title="Start with the questions, no account needed">
            Enter a client’s site and see the buyer questions worth tracking for it, drafted from its
            homepage, category and competitors. Asking them on the assistants is the free audit.
          </SecHead>
          <QuestionPreview captchaSiteKey={captchaSiteKey()} />
        </div>
      </section>

      {/* 1 · что приходит */}
      <section className="sec" id="preview">
        <div className="wrap">
          <SecHead n={2} title="What comes back">
            The card above is the example audit, abridged, with invented names. Your client sees your
            agency’s logo and color.
          </SecHead>
          <div className="g2">
            <div>
              <h3 className="h4" style={{ marginBottom: 6 }}>
                In the report you send
              </h3>
              <ol className="anat">
                <li>
                  <span>
                    <b>Where the client stands today.</b> Share of sampled answers naming the client,
                    next to the tracked competitors’ average.
                  </span>
                </li>
                <li>
                  <span>
                    <b>Ranked work for the next 90 days.</b> Each item with its reason, estimated
                    impact and effort.
                  </span>
                </li>
                <li>
                  <span>
                    <b>Your proposed engagement.</b> {REPORT_COPY.scopeEstimate}
                  </span>
                </li>
                <li>
                  <span>
                    <b>The caveats.</b> A single measurement of how assistants answer today, not a
                    forecast of results.
                  </span>
                </li>
              </ol>
              <p style={{ marginTop: 16 }}>
                <Link className="link" href="/sample-report/audit">
                  Open the full example audit report →
                </Link>
              </p>
            </div>
            <div>
              <h3 className="h4" style={{ marginBottom: 6 }}>
                In your workspace, for your team
              </h3>
              <ul className="rules" style={{ marginTop: 14 }}>
                <li>
                  <span>
                    <b>The diagnosis.</b> Which sources are cited in answers that name competitors
                    and not your client, and whether the gap is on the client’s own pages or outside
                    them.
                  </span>
                </li>
                <li>
                  <span>
                    <b>Question by question.</b> How often each assistant names the client, and which
                    tracked competitor leads where it does not.
                  </span>
                </li>
                <li>
                  <span>
                    <b>The answers themselves.</b> Every answer behind the numbers, with the pages it
                    cited.
                  </span>
                </li>
              </ul>
              <p style={{ marginTop: 16 }}>
                <MethodLink />
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 2 · пять шагов */}
      <section className="sec" id="how">
        <div className="wrap five">
          <div>
            <SecHead n={3} title="Five steps, one client">
              You choose the client and check the questions. The product does the asking, reading
              and ranking.
            </SecHead>
            <div className="note">
              The questions matter more than anything else here. Generated ones are a starting draft;
              edit them until they read the way your client’s buyers actually ask.
            </div>
            <div className="note" style={{ marginTop: 12 }} data-testid="audit-timing">
              <b>Why it is not instant.</b> Every question is asked several times on each assistant, because one answer per question would be noise.
            </div>
          </div>
          <ol className="flow">
            {AUDIT_STEPS.map((step, i) => (
              <li key={step.text}>
                <span className="n">{i + 1}</span>
                <div>
                  <b>{step.text}</b>
                  <span className="who">
                    {step.who.map((w) => (
                      <span key={w.label} className={w.ours ? "who-chip p" : "who-chip"}>
                        {w.label}
                      </span>
                    ))}
                  </span>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* 3 · чем аудит не является */}
      <section className="sec">
        <div className="wrap">
          <SecHead n={4} title="What the audit is not">
            Worth knowing before you send it, because your client will read it as a promise if you
            let them.
          </SecHead>
          <div className="g2">
            <div className="limit">
              <h3>Not a forecast of results</h3>
              <p>{MARKETING_COPY.auditNotForecast}</p>
            </div>
            <div className="limit">
              <h3>A snapshot, not a trend</h3>
              <p>{MARKETING_COPY.auditSnapshot}</p>
            </div>
            <div className="limit">
              <h3>Your pitch, not ours</h3>
              <p>
                The report carries your brand only. The proposed retainer and hours start from
                default values; set your own before you send it.
              </p>
            </div>
            <div className="limit">
              <h3>Nothing is published</h3>
              <p>
                The audit reads what assistants already answer. Nothing changes on the client’s site,
                and the report goes nowhere until you send it.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 4 · вопросы */}
      <section className="sec">
        <div className="wrap">
          <SecHead n={5} title="Before you start" />
          <Faq items={faqItems(paymentsOn)} testId="audit-faq" />
        </div>
      </section>

      <section className="sec">
        <div className="wrap closing">
          <h2 className="h1">Pick one client and see what the assistants say about them</h2>
          <div>
            <p className="prose">
              Create the workspace, add the brand and run the audit. The report is yours to
              send.
            </p>
            <div className="ctas" style={{ marginTop: 22 }}>
              <Link className="btn primary" href="/signup">
                Run a free audit
              </Link>
              <TalkLink />
            </div>
          </div>
        </div>
      </section>
    </MarketingShell>
  );
}
