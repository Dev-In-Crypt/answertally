import { REPORT_COPY } from "../copy";
import type { ReportPayload } from "./schema";

/**
 * Экономика предложения по итогам бесплатного аудита.
 *
 * Ретейнер и часы вводит агентство: их знает только оно, и подставлять сюда
 * «рыночную» цифру значило бы придумывать её за него. Дефолты — отправная
 * точка, а не рекомендация: $3,500 из спека и 20–30 ч (было 8–12 — внешний
 * аудит 06.10.2026 справедливо заметил, что это ~$300 за час и агентство не
 * поверит примеру).
 *
 * Модуль назывался opportunity.ts, но речь здесь о коммерческом предложении,
 * а не о доменной сущности Opportunity (`packages/core/src/opportunities/`).
 * Два разных смысла одного слова в одном пакете читались бы как одно.
 * Ключ `opportunity` в payload отчёта остался прежним: это контракт C4,
 * и уже сохранённые payload'ы должны продолжать разбираться.
 */

export const PROPOSAL_DEFAULTS = {
  retainerUsd: 3500,
  effortHours: { min: 20, max: 30 },
  /** Во что агентству обходится час работы — вторая половина маржи. */
  hourlyCostUsd: 85,
  scopeDays: 90,
} as const;

export interface MarginRange {
  min: number;
  max: number;
}

/**
 * Маржа считается диапазоном, потому что часы — диапазон: больше часов —
 * меньше маржа. Отрицательное значение показывается как есть: предложение,
 * которое не окупается, лучше увидеть до отправки.
 */
export function estimateMarginPct(
  retainerUsd: number,
  effortHours: { min: number; max: number },
  hourlyCostUsd: number,
): MarginRange {
  if (retainerUsd <= 0) {
    throw new Error("Retainer must be positive to estimate margin");
  }

  const marginFor = (hours: number): number =>
    Math.round(((retainerUsd - hours * hourlyCostUsd) / retainerUsd) * 1000) / 10;

  const atMinHours = marginFor(effortHours.min);
  const atMaxHours = marginFor(effortHours.max);

  return { min: Math.min(atMinHours, atMaxHours), max: Math.max(atMinHours, atMaxHours) };
}

/** Средняя видимость конкурентов: разрыв показывается к ней, а не к лидеру. */
export function competitorAverage(competitorVisibility: Record<string, number>): number {
  const values = Object.values(competitorVisibility);
  if (values.length === 0) return 0;

  const sum = values.reduce((total, value) => total + value, 0);
  return Math.round((sum / values.length) * 10) / 10;
}

export interface AuditProposalInputs {
  currentVisibilityPct: number;
  competitorVisibility: Record<string, number>;
  rankedActions: {
    title: string;
    reason: string;
    estimatedImpact: "low" | "medium" | "high";
    effort: "low" | "medium" | "high";
  }[];
  retainerUsd?: number;
  effortHours?: { min: number; max: number };
  hourlyCostUsd?: number;
  scopeDays?: number;
}

type ProposalBlock = NonNullable<ReportPayload["opportunity"]>;

export function buildAuditProposal(inputs: AuditProposalInputs): ProposalBlock {
  const retainerUsd = inputs.retainerUsd ?? PROPOSAL_DEFAULTS.retainerUsd;
  const effortHours = inputs.effortHours ?? PROPOSAL_DEFAULTS.effortHours;
  const hourlyCostUsd = inputs.hourlyCostUsd ?? PROPOSAL_DEFAULTS.hourlyCostUsd;

  if (effortHours.min > effortHours.max) {
    throw new Error("Effort range is inverted: min hours exceed max hours");
  }

  const competitorAverageVisibilityPct = competitorAverage(inputs.competitorVisibility);

  return {
    currentVisibilityPct: inputs.currentVisibilityPct,
    competitorAverageVisibilityPct,
    gapPp: Math.round((inputs.currentVisibilityPct - competitorAverageVisibilityPct) * 10) / 10,
    // Двадцать пунктов — это уже не предложение, а список задач; спек
    // ограничивает верх, а не требует его добрать.
    rankedActions: inputs.rankedActions.slice(0, 20),
    scopeDays: inputs.scopeDays ?? PROPOSAL_DEFAULTS.scopeDays,
    suggestedRetainerUsd: retainerUsd,
    estimatedEffortHours: effortHours,
    estimatedMarginPct: estimateMarginPct(retainerUsd, effortHours, hourlyCostUsd),
  };
}

/** Оговорки, без которых аудит читается как обещание. */
export const PROPOSAL_CAVEATS = [REPORT_COPY.opportunityBasis, REPORT_COPY.scopeEstimate];
