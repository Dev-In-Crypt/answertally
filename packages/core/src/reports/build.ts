import { measurementBasisFor, reportAssistantBasisFor, REPORT_COPY } from "../copy";
import {
  compareAssistantSets,
  shareOverAssistants,
  type AssistantCell,
} from "../metrics/comparability";
import { competitorGapPp } from "../metrics/visibility";
import type { VisibilitySnapshot } from "../metrics/visibility";
import { reportPayloadSchema } from "./schema";
import type { ReportPayload } from "./schema";

/**
 * Сборка клиентского отчёта из уже посчитанных данных.
 *
 * Чистая функция: отчёт уходит конечному клиенту, и он должен воспроизводиться
 * из тех же цифр, что показаны агентству в интерфейсе. Никаких отдельных
 * расчётов «для отчёта» — иначе две цифры разойдутся, и объяснять это придётся
 * агентству перед его клиентом.
 */

export interface ReportInputs {
  clientName: string;
  periodStart: Date;
  periodEnd: Date;
  /** Свёрнутые срезы (все кластеры, все платформы), отсортированные по времени. */
  snapshots: VisibilitySnapshot[];
  completedActions: { title: string; actionType: string }[];
  newCitedUrls: number;
  newBrandMentions: number;
  highestImpact: {
    title: string;
    incrementalPp: number | null;
    confidence: "low" | "medium" | "high";
  } | null;
  nextSprint: string[];
  /** Слабые места, которые нельзя прятать от клиента. */
  caveats: string[];
  /**
   * Движение по отдельным вопросам. Вопросы, где выборки не хватило на
   * сравнение, вызывающий не передаёт вовсе — в отчёте они не должны
   * выглядеть как «не изменилось».
   */
  movement?: { prompt: string; deltaPp: number; sharePct: number }[];
  /** Переходы от ассистентов; не передаются, если аналитику не импортировали. */
  assistantTraffic?: NonNullable<ReportPayload["assistantTraffic"]>;
  /**
   * Платформы, по которым реально есть измерения. От них зависит формулировка
   * оговорки: отчёт по одной платформе не вправе говорить «several platforms».
   */
  measuredPlatforms?: readonly string[];
  /**
   * Срезы по ассистентам на обоих концах периода.
   *
   * Отчёт читается клиентом как одно измерение в двух точках. Если точки
   * стоят на разных наборах ассистентов, это не одно измерение: «было →
   * стало» посчитано от разных знаменателей. Отсюда и концы, и разница
   * пересчитываются по тем, кого мерили и там, и там.
   *
   * Не передали — сравнение остаётся как было: старые вызовы не ломаются.
   */
  assistantCells?: { first: readonly AssistantCell[]; last: readonly AssistantCell[] };
  /** Раздел бесплатного аудита; у платящего клиента его нет. */
  opportunity?: NonNullable<ReportPayload["opportunity"]> | null;
  topOpportunities?: NonNullable<ReportPayload["topOpportunities"]>;
  whatWeLearned?: NonNullable<ReportPayload["whatWeLearned"]>;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/**
 * Разрыв с конкурентом словами: «+9 pp» рядом со словом «gap» клиент читает
 * как отставание, а положительное число значит обратное — клиент впереди.
 */
export function leadText(value: number): string {
  const size = Math.abs(Math.round(value * 10) / 10);
  if (size === 0) return "level (0 pp)";
  return `${size} pp ${value > 0 ? "ahead" : "behind"}`;
}

/** Человекочитаемые названия типов работ для раздела «что сделано». */
const WORK_LABELS: Record<string, string> = {
  refresh_page: "Pages refreshed",
  create_page: "New pages created",
  technical_fix: "Technical fixes",
  structured_data_fix: "Structured data fixes",
  crawler_fix: "Crawlability fixes",
  source_outreach: "Source outreach",
  review_platform: "Review platform work",
  pr_editorial: "Editorial outreach",
  ugc_community: "Community work",
  product_data_update: "Product data updates",
};

export function summariseWork(
  actions: { actionType: string }[],
): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const action of actions) {
    const label = WORK_LABELS[action.actionType] ?? "Other work";
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));
}

/**
 * Диапазон вместо точки: единственная честная форма для оценки, которую
 * нельзя проверить. ±30% вокруг оценки — признание, что точность неизвестна.
 */
export function formatContributionRange(incrementalPp: number | null): string | null {
  if (incrementalPp === null) return null;

  const magnitude = Math.abs(incrementalPp);
  const low = Math.max(0, Math.floor(magnitude * 0.7));
  const high = Math.ceil(magnitude * 1.3);
  const sign = incrementalPp >= 0 ? "+" : "−";

  return low === high ? `${sign}${high} pp` : `${sign}${low}–${high} pp`;
}

/** Собирает и валидирует payload. Невалидный отчёт наружу не уходит. */
export function buildReportPayload(inputs: ReportInputs): ReportPayload {
  const first = inputs.snapshots.at(0) ?? null;
  const last = inputs.snapshots.at(-1) ?? null;

  const measuredIn = (cells: readonly AssistantCell[] | undefined): string[] =>
    (cells ?? []).filter((cell) => cell.sampleCount > 0).map((cell) => cell.assistantId);

  const basis = inputs.assistantCells
    ? compareAssistantSets(
        measuredIn(inputs.assistantCells.last),
        measuredIn(inputs.assistantCells.first),
      )
    : null;

  /**
   * Пересчитываются оба конца, а не только разница.
   *
   * Две цифры, подписанные «было» и «стоит сейчас», обязаны стоять на одном
   * знаменателе — иначе подпись врёт, даже если разница между ними честная.
   */
  const restricted =
    basis && basis.delta === "recompute-on-shared" && inputs.assistantCells
      ? {
          before: shareOverAssistants(inputs.assistantCells.first, basis.shared).pct,
          after: shareOverAssistants(inputs.assistantCells.last, basis.shared).pct,
        }
      : null;

  const visibilityBefore = restricted?.before ?? (first ? first.clientVisibilityPct : 0);
  const visibilityAfter = restricted?.after ?? (last ? last.clientVisibilityPct : 0);

  /** Общего ассистента на весь период не нашлось — разницы нет вовсе. */
  const deltaPp =
    basis && basis.delta === "suppress" ? null : round1(visibilityAfter - visibilityBefore);

  const assistantCaveat = basis ? reportAssistantBasisFor(basis) : null;

  /**
   * Оговорка о природе измерения описывает то, по чему считались числа:
   * после пересчёта это общая часть, а не объединение наборов.
   */
  const basisPlatforms =
    basis && basis.delta === "recompute-on-shared" ? basis.shared : inputs.measuredPlatforms ?? [];

  const payload: ReportPayload = {
    client: { name: inputs.clientName },
    period: {
      start: inputs.periodStart.toISOString().slice(0, 10),
      end: inputs.periodEnd.toISOString().slice(0, 10),
    },
    visibility: { before: visibilityBefore, after: visibilityAfter },
    competitorGap: {
      before: first ? competitorGapPp(first) : 0,
      after: last ? competitorGapPp(last) : 0,
    },
    ...(inputs.snapshots.length <= 1 ? { firstMeasurement: true } : {}),
    workCompleted: summariseWork(inputs.completedActions),
    results: {
      newCitedUrls: inputs.newCitedUrls,
      newBrandMentions: inputs.newBrandMentions,
      visibilityDeltaPp: deltaPp,
    },
    highestImpactAction: null,
    nextSprint: inputs.nextSprint,
    // Пустой список не кладём: раздел «что изменилось» без строк выглядел бы
    // как «ничего не изменилось», а это другое утверждение.
    ...(inputs.movement && inputs.movement.length > 0 ? { movement: inputs.movement } : {}),
    // Ноль сессий — это «не импортировали», а не «никто не пришёл».
    ...(inputs.assistantTraffic && inputs.assistantTraffic.totalSessions > 0
      ? { assistantTraffic: inputs.assistantTraffic }
      : {}),
    // Пустые разделы не пишутся вовсе: «ничего не нашли» и «раздела нет» —
    // разные утверждения, и второе честнее, когда сказать нечего.
    ...(inputs.topOpportunities && inputs.topOpportunities.length > 0
      ? { topOpportunities: inputs.topOpportunities }
      : {}),
    ...(inputs.whatWeLearned && inputs.whatWeLearned.length > 0
      ? { whatWeLearned: inputs.whatWeLearned }
      : {}),
    opportunity: inputs.opportunity ?? null,
    // Пояснение о природе измерения идёт в каждом отчёте, а не по желанию,
    // и описывает то, что измерялось на самом деле.
    caveats: [
      measurementBasisFor(basisPlatforms),
      ...(assistantCaveat ? [assistantCaveat] : []),
      ...inputs.caveats,
    ],
  };

  const contribution = inputs.highestImpact
    ? formatContributionRange(inputs.highestImpact.incrementalPp)
    : null;

  if (inputs.highestImpact && contribution) {
    payload.highestImpactAction = {
      title: inputs.highestImpact.title,
      estimatedContribution: contribution,
      /**
       * Без группы сравнения уверенность не бывает выше низкой.
       *
       * Иначе в отчёте рядом стоят две несовместимые фразы: «сравнивать было
       * не с чем» в оговорках и «уверенность: средняя» под вкладом действия.
       * Клиент читает вторую и считает вклад измеренным. Занижение здесь
       * намеренное: когда часть экспериментов шла без контрольных тем,
       * сказать «мы не уверены» честнее, чем разбирать, какой именно из них
       * попал в «самое влиятельное».
       */
      /**
       * Смена состава ассистентов понижает уверенность по той же причине,
       * что и отсутствие группы сравнения: часть периода измерялась не тем
       * же, чем другая, и отделить вклад действия от смены знаменателя
       * нечем.
       */
      confidence:
        inputs.caveats.includes(REPORT_COPY.noComparisonGroup) || assistantCaveat !== null
          ? "low"
          : inputs.highestImpact.confidence,
    };
  }

  return reportPayloadSchema.parse(payload);
}
