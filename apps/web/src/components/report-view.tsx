import { ASSISTANTS, formatDay, formatPeriod, leadText, MEASUREMENT_COPY, type ReportPayload } from "@repo/core";
import { AssistantBars, assistantColor, CompetitorBars, DeltaBar, ShareRing, TrendLine } from "./report-charts";

/** Имена ассистентов из каталога: в отчёте клиента идентификаторов быть не должно. */
const ASSISTANT_LABELS: Record<string, string> = Object.fromEntries(
  ASSISTANTS.map((assistant) => [assistant.id, assistant.label]),
);

/**
 * Клиентский отчёт. Ноль брендинга продукта — только агентство (инвариант 3).
 *
 * Это server-компонент без интерактива: страницу открывают по ссылке без
 * регистрации, и чем меньше на ней исполняемого кода, тем меньше поводов
 * ей не доверять. Печатная версия — та же разметка, отсюда print-стили.
 */

function Stat({
  label,
  value,
  hint,
  testId,
}: {
  label: string;
  value: string;
  hint?: string;
  testId?: string;
}) {
  return (
    <div className="flex flex-col gap-1 rounded-lg border p-5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span data-testid={testId} className="metric text-3xl font-semibold tracking-tight">
        {value}
      </span>
      {hint && <span className="text-sm text-muted-foreground">{hint}</span>}
    </div>
  );
}

/**
 * Прочерк, а не ноль: «изменения нет» и «сравнивать было нечем» — разные
 * утверждения, и второе клиенту важнее первого.
 */
function formatPp(value: number | null): string {
  if (value === null) return "–";
  return `${value >= 0 ? "+" : ""}${value} pp`;
}

export function ReportView({
  payload,
  agency,
  approved,
}: {
  payload: ReportPayload;
  agency: { name: string; logoUrl: string | null; brandColor: string };
  approved: { at: Date; byName: string | null } | null;
}) {
  return (
    // Цвет агентства подставляется в accent: на этой странице бренд — его.
    // Переопределяется именно `--primary`: тема собрана как `@theme inline`,
    // и утилиты подставляют этот токен напрямую, минуя `--color-primary`.
    <div
      data-surface="report"
      className="mx-auto flex min-h-screen w-full max-w-3xl flex-col gap-8 px-6 py-10"
      style={{ ["--primary" as string]: agency.brandColor }}
    >
      {/* Полоса цветом агентства: единственное, что на странице читается как
          бренд, когда логотип ещё не загружен. */}
      <div data-testid="brand-bar" className="h-1.5 w-full rounded-full bg-primary" />

      <header className="flex items-center justify-between gap-4 border-b pb-6">
        <div className="flex items-center gap-3">
          {agency.logoUrl ? (
            // Обычный img, а не next/image: логотип агентства лежит в своём
            // хранилище и на печатной версии должен грузиться без оптимизатора.
            <img
              data-testid="agency-logo"
              src={agency.logoUrl}
              alt={agency.name}
              className="h-10 w-auto object-contain"
            />
          ) : (
            <span data-testid="agency-name" className="text-lg font-semibold text-primary">
              {agency.name}
            </span>
          )}
        </div>
        <div className="text-right text-sm text-muted-foreground">
          <p className="font-medium text-foreground">{payload.client.name}</p>
          <p className="metric">
            {formatPeriod(payload.period.start, payload.period.end)}
          </p>
        </div>
      </header>

      <section className="flex flex-col gap-4">
        <h1 className="text-2xl font-semibold tracking-tight">
          {/* Аудит и отчёт по ретейнеру — разные документы, и заголовки у них разные. */}
          {payload.opportunity ? "AI answer visibility audit" : "AI answer visibility report"}
        </h1>

        {/* Одна фраза перед цифрами: клиент агентства читает отчёт по диагонали,
            и первое, что он должен унести, — что это оценка, а не счётчик. */}
        <p data-testid="report-summary" className="max-w-prose text-sm leading-relaxed">
          Across the tracked buyer questions, {payload.client.name} was named in an estimated{" "}
          <span className="metric font-medium">{payload.visibility.after}%</span> of answers this
          period
          {payload.firstMeasurement ? (
            <>
              . This is the first measurement, so change over time shows from the next report
            </>
          ) : payload.results.visibilityDeltaPp === null ? (
            <>
              . The earlier figure rests on a different set of assistants and is shown on its own at{" "}
              <span className="metric">{payload.visibility.before}%</span>
            </>
          ) : (
            <>
              ,{" "}
              {payload.results.visibilityDeltaPp === 0
                ? "unchanged"
                : payload.results.visibilityDeltaPp > 0
                  ? "up"
                  : "down"}{" "}
              from{" "}
              <span className="metric">{payload.visibility.before}%</span>
            </>
          )}
          . Against the strongest tracked competitor, {payload.client.name} stands{" "}
          <span className="metric">{leadText(payload.competitorGap.after)}</span>. Every figure is
          an estimate from repeated samples of assistant answers, not a count of real buyer
          conversations.
        </p>

        <div className="grid gap-3 sm:grid-cols-2">
          <Stat
            label="Named in answers"
            testId="report-visibility"
            value={
              payload.firstMeasurement
                ? `${payload.visibility.after}%`
                : `${payload.visibility.before}% → ${payload.visibility.after}%`
            }
            hint={
              payload.firstMeasurement
                ? "First measurement"
                : `${formatPp(payload.results.visibilityDeltaPp)} over the period`
            }
          />
          <Stat
            label="Against the strongest competitor"
            testId="report-gap"
            value={
              payload.firstMeasurement
                ? leadText(payload.competitorGap.after)
                : `${leadText(payload.competitorGap.before)} → ${leadText(payload.competitorGap.after)}`
            }
            hint="Versus the best-performing tracked competitor"
          />
        </div>

        {/* Те же цифры картинкой: клиент сначала смотрит, потом читает. */}
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border p-5">
            <ShareRing
              sharePct={payload.visibility.after}
              caption={
                payload.results.sampledAnswers !== undefined
                  ? `of answers named ${payload.client.name}: ${payload.results.newBrandMentions} of ${payload.results.sampledAnswers} sampled this period`
                  : `of answers named ${payload.client.name} this period`
              }
            />
          </div>
          {payload.competitors && payload.competitors.length > 0 && (
            <div className="flex flex-col gap-3 rounded-lg border p-5">
              <h2 className="text-sm font-medium">Named in answers, against tracked competitors</h2>
              <CompetitorBars
                clientName={payload.client.name}
                clientPct={payload.visibility.after}
                competitors={payload.competitors}
              />
            </div>
          )}
        </div>
      </section>

      {payload.byAssistant && payload.byAssistant.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">By assistant</h2>
          <AssistantBars rows={payload.byAssistant} labels={ASSISTANT_LABELS} />
          <p className="text-sm text-muted-foreground">
            Each assistant is counted on its own answers; the figure above combines them.
          </p>
        </section>
      )}

      {payload.trend && payload.trend.length > 1 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Week by week</h2>
          <TrendLine points={payload.trend} />
          <p className="text-sm text-muted-foreground">
            Share of answers naming {payload.client.name}, by week, on the same assistants throughout.
          </p>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Work completed</h2>
        {payload.workCompleted.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            No delivery work was recorded in this period.
          </p>
        ) : (
          <ul data-testid="report-work" className="flex flex-col gap-1 text-sm">
            {payload.workCompleted.map((item) => (
              <li key={item.label} className="flex justify-between border-b py-2 last:border-0">
                <span>{item.label}</span>
                <span className="metric font-medium">{item.count}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {payload.movement && payload.movement.length > 0 && (
        /* «Что изменилось» — первый вопрос клиента, и он про конкретные
           вопросы покупателей, а не про одну усреднённую цифру. */
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">What moved</h2>
          <ul data-testid="report-movement" className="flex flex-col gap-1 text-sm">
            {payload.movement.map((item, _i, all) => (
              <li key={item.prompt} className="flex items-center justify-between gap-4 border-b py-2 last:border-0">
                <span className="flex-1">{item.prompt}</span>
                <DeltaBar deltaPp={item.deltaPp} maxAbs={Math.max(...all.map((m) => Math.abs(m.deltaPp)))} />
                <span className="metric w-28 shrink-0 text-right font-medium">
                  {item.sharePct}% ({item.deltaPp >= 0 ? "+" : ""}
                  {item.deltaPp} pp)
                </span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted-foreground">{MEASUREMENT_COPY.movementBasis}</p>
        </section>
      )}

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Results</h2>
        <ul data-testid="report-results" className="flex flex-col gap-1 text-sm">
          {/* В первом измерении «новых» источников нет: сравнивать не с чем. */}
          {!payload.firstMeasurement && (
            <li className="flex justify-between border-b py-2">
              <span>Sources cited for the first time</span>
              <span className="metric font-medium">{payload.results.newCitedUrls}</span>
            </li>
          )}
          <li className="flex justify-between border-b py-2">
            {payload.results.sampledAnswers !== undefined ? (
              <>
                <span>Answers naming {payload.client.name}</span>
                <span className="metric font-medium">
                  {payload.results.newBrandMentions} of {payload.results.sampledAnswers}
                </span>
              </>
            ) : (
              <>
                <span>Brand mentions in AI answers</span>
                <span className="metric font-medium">{payload.results.newBrandMentions}</span>
              </>
            )}
          </li>
          <li className="flex justify-between py-2">
            <span>Visibility change</span>
            <span className="metric font-medium">
              {payload.firstMeasurement
                ? "first measurement"
                : formatPp(payload.results.visibilityDeltaPp)}
            </span>
          </li>
        </ul>
      </section>

      {payload.assistantTraffic && (
        /* Другое наблюдение, а не следствие видимости: заголовок и оговорка
           держат эти цифры на своём месте. */
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Visits referred by assistants</h2>
          <ul data-testid="report-traffic" className="flex flex-col gap-1 text-sm">
            {payload.assistantTraffic.byAssistant.map((entry) => (
              <li
                key={entry.assistant}
                className="flex justify-between border-b py-2 last:border-0"
              >
                <span className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: assistantColor(entry.assistant) }}
                  />
                  {ASSISTANT_LABELS[entry.assistant] ?? entry.assistant}
                </span>
                <span className="metric font-medium">
                  {entry.sessions.toLocaleString("en-US")}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-sm text-muted-foreground">{MEASUREMENT_COPY.trafficUndercount}</p>
        </section>
      )}

      {payload.highestImpactAction && (
        <section className="flex flex-col gap-2 rounded-lg border border-l-4 border-l-primary p-5">
          <h2 className="text-lg font-medium">Highest-impact action</h2>
          <p className="font-medium">{payload.highestImpactAction.title}</p>
          <p className="metric text-sm text-muted-foreground">
            Estimated contribution: {payload.highestImpactAction.estimatedContribution} ·{" "}
            Confidence: {payload.highestImpactAction.confidence}
          </p>
        </section>
      )}

      {payload.opportunity && (
        <section data-testid="report-opportunity" className="flex flex-col gap-4">
          <h2 className="text-lg font-medium">Where the opportunity is</h2>

          <div className="grid gap-3 sm:grid-cols-2">
            <Stat
              label="Visibility today"
              testId="opportunity-visibility"
              value={`${payload.opportunity.currentVisibilityPct}%`}
              hint="Share of answers mentioning the brand"
            />
            <Stat
              label="Tracked competitors, average"
              testId="opportunity-competitors"
              value={`${payload.opportunity.competitorAverageVisibilityPct}%`}
              hint={`${formatPp(payload.opportunity.gapPp)} versus the average`}
            />
          </div>

          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-medium">
              Ranked work for the next {payload.opportunity.scopeDays} days
            </h3>
            {/* Причина стоит рядом с каждой строкой: без неё это список задач,
                который клиент не может ни проверить, ни оспорить (инвариант 7). */}
            <ol
              data-testid="opportunity-actions"
              className="flex list-inside list-decimal flex-col gap-2 text-sm"
            >
              {payload.opportunity.rankedActions.map((action) => (
                <li key={action.title} className="border-b py-2 last:border-0">
                  <span className="font-medium">{action.title}</span>
                  <span className="block pl-5 text-muted-foreground">{action.reason}</span>
                  <span className="block pl-5 text-xs text-muted-foreground">
                    Estimated impact: {action.estimatedImpact} · Effort: {action.effort}
                  </span>
                </li>
              ))}
            </ol>
          </div>

          <div className="flex flex-col gap-1 rounded-lg border border-l-4 border-l-primary p-5 text-sm">
            <span className="text-muted-foreground">Proposed engagement</span>
            <span data-testid="opportunity-retainer" className="metric text-lg font-semibold">
              ${payload.opportunity.suggestedRetainerUsd.toLocaleString("en-US")} / month
            </span>
            <span className="metric text-muted-foreground">
              Estimated effort: {payload.opportunity.estimatedEffortHours.min}–
              {payload.opportunity.estimatedEffortHours.max} h per month
            </span>
          </div>
        </section>
      )}

      {payload.whatWeLearned && payload.whatWeLearned.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">What we learned</h2>
          <ul data-testid="report-learned" className="flex flex-col gap-3 text-sm">
            {payload.whatWeLearned.map((item) => (
              <li key={item.title} className="flex flex-col gap-1">
                <span className="font-medium">{item.title}</span>
                <span className="text-muted-foreground">{item.observed}</span>
                <span className="text-xs text-muted-foreground">Evidence: {item.confidence}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {payload.topOpportunities && payload.topOpportunities.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Where the next gains are</h2>
          <ul data-testid="report-top-opportunities" className="flex flex-col gap-3 text-sm">
            {payload.topOpportunities.map((item) => (
              <li key={item.title} className="flex flex-col gap-1">
                <span className="font-medium">{item.title}</span>
                {/* Причина обязательна: пункт без объяснения клиент не может
                    ни оценить, ни оспорить. */}
                <span className="text-muted-foreground">{item.reason}</span>
                <span className="text-xs text-muted-foreground">
                  {item.affectedPrompts} tracked{" "}
                  {item.affectedPrompts === 1 ? "question" : "questions"} · evidence:{" "}
                  {item.evidence}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {payload.nextSprint.length > 0 && (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">Next sprint</h2>
          <ol data-testid="report-next" className="flex list-inside list-decimal flex-col gap-1 text-sm">
            {payload.nextSprint.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ol>
        </section>
      )}

      {/* Оговорки — часть отчёта, а не мелкий шрифт: клиент принимает решения
          по этим цифрам и должен понимать, чего они не значат. */}
      <section className="flex flex-col gap-2 rounded-lg border border-dashed p-5">
        <h2 className="text-sm font-medium">How to read this</h2>
        <ul data-testid="report-caveats" className="flex flex-col gap-1.5 text-sm text-muted-foreground">
          {payload.caveats.map((caveat) => (
            <li key={caveat}>{caveat}</li>
          ))}
        </ul>
      </section>

      {approved && (
        <p data-testid="report-approved" className="text-sm text-muted-foreground">
          Approved{approved.byName ? ` by ${approved.byName}` : ""} on{" "}
          {/* Формат фиксирован: иначе дата зависит от локали и пояса сервера
              (PDF) или читателя — 10/4/2026 читается по-разному. */}
          <span className="metric">
            {formatDay(approved.at)}
          </span>
          .
        </p>
      )}
    </div>
  );
}
