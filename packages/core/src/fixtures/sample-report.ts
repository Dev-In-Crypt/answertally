import { REPORT_COPY } from "../copy";
import { buildReportPayload } from "../reports/build";
import { buildAuditProposal } from "../reports/proposal";
import type { ReportPayload } from "../reports/schema";
import type { VisibilitySnapshot } from "../metrics/visibility";

/**
 * Демонстрационный отчёт для публичного примера на сайте.
 *
 * Собирается теми же билдерами, что и настоящий отчёт, а не пишется литералом:
 * литерал прошёл бы проверку типов, но разъехался бы с тем, что продукт реально
 * печатает — потерял бы обязательные оговорки, показал бы вклад точкой вместо
 * диапазона, назвал бы разрыв, не равный вычисленному. Сборка на уровне модуля
 * означает, что невалидные данные роняют импорт пакета, а не показываются
 * посетителю.
 *
 * Все имена вымышлены. Конкуренты — тоже, и процитированные площадки тоже:
 * приписать реальной компании выдуманную долю упоминаний на публичной
 * странице значит сочинить утверждение о третьем лице. Все домены — в зоне
 * `.example`, её нельзя зарегистрировать (RFC 2606), поэтому ни один из них
 * не может однажды оказаться чьим-то.
 */

export const SAMPLE_AGENCY = {
  name: "Harbor & Pine",
  /** null — логотипа неоткуда взять: внешние картинки в сборке запрещены. */
  logoUrl: null,
  brandColor: "#8B2F4E",
} as const;

export const SAMPLE_CLIENT_NAME = "Fernpost";

const COMPETITORS_AT_AUDIT = { Quillstack: 39.6, Loambox: 30.2, Tidepin: 18.1 };

function snapshot(
  clientVisibilityPct: number,
  competitorVisibility: Record<string, number>,
  periodStart: string,
  periodEnd: string,
): VisibilitySnapshot {
  return {
    clusterId: null,
    platform: null,
    periodStart: new Date(periodStart),
    periodEnd: new Date(periodEnd),
    clientVisibilityPct,
    competitorVisibility,
    sampleCount: 72,
    sufficient: true,
  };
}

/** Клетки по ассистентам для диаграммы «по ассистентам»: в сумме — доля снимка. */
function cells(chatgpt: number, perplexity: number, google: number, sampleCount: number) {
  return [
    { assistantId: "chatgpt", sampleCount, clientVisibilityPct: chatgpt },
    { assistantId: "perplexity", sampleCount, clientVisibilityPct: perplexity },
    { assistantId: "ai-overviews", sampleCount, clientVisibilityPct: google },
  ];
}

/**
 * Ранжированные работы. Формулировки причин повторяют стиль настоящих правил
 * диагностики: сначала факт из измерений, потом что из него следует.
 */
const RANKED_ACTIONS = [
  {
    title: "Get the client covered on reviewhub.example",
    reason:
      "reviewhub.example is cited in 18% of answers for this category (14 citations). Quillstack and Loambox appear in those answers; Fernpost does not.",
    estimatedImpact: "high" as const,
    effort: "medium" as const,
  },
  {
    title: "Get the client covered on forum.example",
    reason:
      "forum.example is cited in 12% of answers here (9 citations), and threads comparing the category name competitors without mentioning Fernpost.",
    estimatedImpact: "medium" as const,
    effort: "medium" as const,
  },
  {
    title: "Publish a page that answers this cluster directly",
    reason:
      "No page from fernpost.example appears among the 9 sources cited for the comparison cluster, so there is nothing of the client's own to cite.",
    estimatedImpact: "medium" as const,
    effort: "medium" as const,
  },
  {
    title: "Refresh the fernpost.example pricing page",
    reason:
      "The page is cited 6 times here, but the brand is not mentioned in those answers: it is being read without carrying the name.",
    estimatedImpact: "medium" as const,
    effort: "low" as const,
  },
  {
    title: "Get the client covered on listings.example",
    reason:
      "listings.example is cited in 7% of answers here (5 citations), with two competitors listed and the client absent.",
    estimatedImpact: "medium" as const,
    effort: "low" as const,
  },
  {
    title: "Answer the migration question in the docs",
    reason:
      "Three answers recommend a competitor specifically for migration; the client's docs do not cover it at all.",
    estimatedImpact: "low" as const,
    effort: "low" as const,
  },
];

/**
 * Отчёт бесплатного аудита: один прогон, снимок «как сейчас».
 * Работ не сделано и результатов нет — ровно то, что собирает продукт,
 * без приукрашивания.
 */
export const SAMPLE_AUDIT_REPORT: ReportPayload = buildReportPayload({
  clientName: SAMPLE_CLIENT_NAME,
  periodStart: new Date("2026-09-21T00:00:00.000Z"),
  periodEnd: new Date("2026-09-28T00:00:00.000Z"),
  snapshots: [
    snapshot(11.5, COMPETITORS_AT_AUDIT, "2026-09-21T00:00:00.000Z", "2026-09-28T00:00:00.000Z"),
  ],
  completedActions: [],
  newCitedUrls: 0,
  // 15 из 130 = 11.5%: сходится с долей снимка.
  newBrandMentions: 15,
  sampledAnswers: 130,
  highestImpact: null,
  nextSprint: RANKED_ACTIONS.slice(0, 3).map((action) => action.title),
  caveats: [REPORT_COPY.opportunityBasis, REPORT_COPY.scopeEstimate],
  // 5, 6 и 4 из 43–44 ответов: в сумме те же 15 из 130.
  assistantCells: { first: cells(11.4, 14, 9.3, 43), last: cells(11.4, 14, 9.3, 43) },
  measuredPlatforms: ["chatgpt", "perplexity", "ai-overviews"],
  opportunity: buildAuditProposal({
    currentVisibilityPct: 11.5,
    competitorVisibility: COMPETITORS_AT_AUDIT,
    rankedActions: RANKED_ACTIONS,
  }),
});

/**
 * Квартальный отчёт по ретейнеру. Период — 90 дней: столько занимает у моделей
 * переобход и сдвиг цитат, и короче показывать нечестно.
 *
 * Клиент к концу периода всё ещё позади лидера. Пример, где выиграли всухую,
 * не поверит ни одно агентство, и он противоречил бы тому, как продукт
 * подаёт оценки.
 */
export const SAMPLE_DELIVERY_REPORT: ReportPayload = buildReportPayload({
  clientName: SAMPLE_CLIENT_NAME,
  periodStart: new Date("2026-07-01T00:00:00.000Z"),
  periodEnd: new Date("2026-09-30T00:00:00.000Z"),
  snapshots: [
    snapshot(
      19.4,
      { Quillstack: 41.2, Loambox: 33.7, Tidepin: 22.5 },
      "2026-07-06T00:00:00.000Z",
      "2026-07-13T00:00:00.000Z",
    ),
    // Промежуточные недели — для линии по неделям; концы периода те же.
    snapshot(20.8, { Quillstack: 41.6, Loambox: 33.1, Tidepin: 22.9 }, "2026-07-20T00:00:00.000Z", "2026-07-27T00:00:00.000Z"),
    snapshot(22.1, { Quillstack: 41.9, Loambox: 32.8, Tidepin: 23.4 }, "2026-08-03T00:00:00.000Z", "2026-08-10T00:00:00.000Z"),
    snapshot(21.5, { Quillstack: 42.4, Loambox: 32.2, Tidepin: 23.8 }, "2026-08-17T00:00:00.000Z", "2026-08-24T00:00:00.000Z"),
    snapshot(24.9, { Quillstack: 42.1, Loambox: 31.9, Tidepin: 24.1 }, "2026-08-31T00:00:00.000Z", "2026-09-07T00:00:00.000Z"),
    snapshot(26.3, { Quillstack: 41.8, Loambox: 31.6, Tidepin: 24.5 }, "2026-09-14T00:00:00.000Z", "2026-09-21T00:00:00.000Z"),
    snapshot(
      28.6,
      { Quillstack: 42, Loambox: 31.4, Tidepin: 24.8 },
      "2026-09-21T00:00:00.000Z",
      "2026-09-28T00:00:00.000Z",
    ),
  ],
  completedActions: [
    { title: "Refreshed the comparison page", actionType: "refresh_page" },
    { title: "Refreshed the pricing page", actionType: "refresh_page" },
    { title: "Refreshed the integrations page", actionType: "refresh_page" },
    { title: "Refreshed the migration guide", actionType: "refresh_page" },
    { title: "Listed on a category review site", actionType: "review_platform" },
    { title: "Updated the second review listing", actionType: "review_platform" },
    { title: "Pitched two category round-ups", actionType: "source_outreach" },
    { title: "Answered a comparison thread", actionType: "source_outreach" },
    { title: "Contributed to a community wiki page", actionType: "source_outreach" },
    { title: "Published the migration landing page", actionType: "create_page" },
    { title: "Published the alternatives page", actionType: "create_page" },
    { title: "Fixed product schema on key pages", actionType: "structured_data_fix" },
  ],
  newCitedUrls: 7,
  // Доля за квартал росла с 19% до 29%; 104 из 432 = 24%, середина пути.
  newBrandMentions: 104,
  sampledAnswers: 432,
  highestImpact: {
    title: "Refreshed the comparison page",
    incrementalPp: 4,
    // Вклад показывается только при нетронутых темах для сравнения. Тем
    // для сравнения было мало, отсюда низкая уверенность.
    confidence: "low",
  },
  nextSprint: [
    "Get covered on the two remaining review platforms",
    "Publish a head-to-head page against Quillstack, the competitor the answers name most",
    "Refresh the integrations page with current partners",
  ],
  caveats: [],
  assistantCells: { first: cells(22.2, 16.7, 19.4, 24), last: cells(33.3, 25, 27.5, 24) },
  measuredPlatforms: ["chatgpt", "perplexity", "ai-overviews"],
});

/**
 * Числа для витрины. Читаются из собранных отчётов, а не переписываются руками:
 * иначе страница и пример однажды покажут разное.
 */
export const SAMPLE_HIGHLIGHTS = {
  auditVisibilityPct: SAMPLE_AUDIT_REPORT.opportunity?.currentVisibilityPct ?? 0,
  auditCompetitorAvgPct: SAMPLE_AUDIT_REPORT.opportunity?.competitorAverageVisibilityPct ?? 0,
  auditGapPp: SAMPLE_AUDIT_REPORT.opportunity?.gapPp ?? 0,
  auditActions: SAMPLE_AUDIT_REPORT.opportunity?.rankedActions.length ?? 0,
  deliveryBefore: SAMPLE_DELIVERY_REPORT.visibility.before,
  deliveryAfter: SAMPLE_DELIVERY_REPORT.visibility.after,
  deliveryDeltaPp: SAMPLE_DELIVERY_REPORT.results.visibilityDeltaPp,
  deliveryGapBefore: SAMPLE_DELIVERY_REPORT.competitorGap.before,
  deliveryGapAfter: SAMPLE_DELIVERY_REPORT.competitorGap.after,
  deliveryContribution: SAMPLE_DELIVERY_REPORT.highestImpactAction?.estimatedContribution ?? "",
  /** Сделанная работа — то, чем ретейнер оправдывается перед клиентом. */
  deliveryWork: SAMPLE_DELIVERY_REPORT.workCompleted,
  deliveryNewCitedUrls: SAMPLE_DELIVERY_REPORT.results.newCitedUrls,
  deliveryNewBrandMentions: SAMPLE_DELIVERY_REPORT.results.newBrandMentions,
} as const;
