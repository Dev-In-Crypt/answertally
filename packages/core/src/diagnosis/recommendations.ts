import { z } from "zod";
import type { Diagnosis, InfluentialSource } from "./source-graph";
import type { SourceType } from "../sources/domains";

/**
 * Рекомендации: что делать дальше и почему.
 *
 * Принцип 6 из спека — «every recommendation must explain why». Здесь это
 * не соглашение, а тип: рекомендация без непустого reason не собирается
 * (см. recommendationSchema и makeRecommendation).
 */

export const ACTION_TYPES = [
  "refresh_page",
  "create_page",
  "technical_fix",
  "structured_data_fix",
  "crawler_fix",
  "source_outreach",
  "review_platform",
  "pr_editorial",
  "ugc_community",
  "product_data_update",
] as const;

export type ActionType = (typeof ACTION_TYPES)[number];

/**
 * Числа, на которых стоит рекомендация.
 *
 * До этого они существовали только внутри строки `reason`: прочитать их
 * человек мог, а собрать из них рабочее задание или сверить результат —
 * нет. Хранятся отдельно от текста, потому что текст меняется, а факт
 * измерения остаётся фактом измерения.
 */
export const recommendationEvidenceSchema = z.object({
  sourceType: z.string().optional(),
  /** Сколько раз источник процитирован в измеренном периоде. */
  citations: z.number().int().nonnegative().optional(),
  /** Доля цитирований кластера, приходящаяся на источник. */
  sharePct: z.number().nonnegative().optional(),
  /** Конкуренты, присутствующие там, где клиента нет. */
  competitorsPresent: z.array(z.string().max(100)).max(50).default([]),
  /** Сколько влиятельных источников всего рассматривалось. */
  influentialCount: z.number().int().nonnegative().optional(),
});

export type RecommendationEvidence = z.infer<typeof recommendationEvidenceSchema>;

export const recommendationSchema = z.object({
  actionType: z.enum(ACTION_TYPES),
  // Границы длины — потому что схема принимает и ввод агентства (действие
  // из рекомендации), а не только то, что собрал сам продукт.
  title: z.string().min(1).max(500),
  /** Непустой по схеме: рекомендация без объяснения бесполезна агентству. */
  reason: z.string().min(1).max(4000),
  estimatedImpact: z.enum(["low", "medium", "high"]),
  effort: z.enum(["low", "medium", "high"]),
  sourceDomain: z.string().max(255).optional(),
  clusterId: z.string().max(64).optional(),
  /** Правило, которое породило рекомендацию — видно, откуда она взялась. */
  rule: z.string().min(1).max(200),
  evidence: recommendationEvidenceSchema.optional(),
});

export type Recommendation = z.infer<typeof recommendationSchema>;

/** Единственный способ собрать рекомендацию: схема проверяется на входе. */
export function makeRecommendation(input: Recommendation): Recommendation {
  return recommendationSchema.parse(input);
}

/** Типы источников, куда попадание — это работа с людьми, а не с кодом. */
const OUTREACH_ACTION_BY_TYPE: Partial<Record<SourceType, ActionType>> = {
  editorial: "pr_editorial",
  review: "review_platform",
  directory: "source_outreach",
  ugc: "ugc_community",
};

function impactFromShare(sharePct: number): "low" | "medium" | "high" {
  if (sharePct >= 15) return "high";
  if (sharePct >= 7) return "medium";
  return "low";
}

/**
 * Правило 1. Влиятельный источник, где есть конкуренты и нет клиента.
 * Самая частая причина разрыва по спеку — и единственная, где действие
 * очевидно: попасть туда, где уже цитируются другие.
 */
export function recommendMissingSources(
  influential: InfluentialSource[],
  clusterId?: string,
): Recommendation[] {
  return influential
    .filter(
      (source) =>
        !source.clientPresent &&
        source.competitorsPresent.length > 0 &&
        source.sourceType !== null &&
        source.sourceType in OUTREACH_ACTION_BY_TYPE,
    )
    .map((source) => {
      const actionType = OUTREACH_ACTION_BY_TYPE[source.sourceType as SourceType] ?? "source_outreach";
      const competitors = source.competitorsPresent.join(", ");

      return makeRecommendation({
        actionType,
        title: `Get the client covered on ${source.domain}`,
        reason: `${source.domain} is cited in ${source.sharePct}% of answers here (${source.citations} citations). ${competitors} appear in those answers; the client does not.`,
        estimatedImpact: impactFromShare(source.sharePct),
        effort: actionType === "review_platform" ? "low" : "medium",
        sourceDomain: source.domain,
        rule: "missing-from-influential-source",
        ...(clusterId ? { clusterId } : {}),
        // Те же числа, что и в тексте выше, но пригодные для работы.
        evidence: {
          ...(source.sourceType ? { sourceType: source.sourceType } : {}),
          citations: source.citations,
          sharePct: source.sharePct,
          competitorsPresent: source.competitorsPresent,
        },
      });
    });
}

/**
 * Правило 2. Ни одна страница собственного домена не цитируется.
 * Это не значит «нужно больше контента вообще» — это значит, что по данному
 * набору вопросов у клиента нет страницы, которую модели считают ответом.
 */
export function recommendOwnedPage(
  diagnosis: Diagnosis,
  clusterId?: string,
): Recommendation[] {
  const ownedCitations = diagnosis.mix.find((entry) => entry.sourceType === "owned")?.citations ?? 0;
  if (ownedCitations > 0 || diagnosis.influential.length === 0) {
    return [];
  }

  return [
    makeRecommendation({
      actionType: "create_page",
      title: "Publish a page that answers this cluster directly",
      reason: `No page from the client's own domain appears among the ${diagnosis.influential.length} sources cited for this cluster.`,
      estimatedImpact: "medium",
      effort: "medium",
      rule: "no-owned-source-cited",
      ...(clusterId ? { clusterId } : {}),
      evidence: {
        competitorsPresent: [],
        influentialCount: diagnosis.influential.length,
      },
    }),
  ];
}

/**
 * Правило 3. Собственная страница цитируется, но клиента в этих ответах нет.
 * Страница попадает в выдачу, но не убеждает — это работа над содержанием,
 * а не над новым материалом.
 */
export function recommendOwnedRefresh(
  influential: InfluentialSource[],
  clusterId?: string,
): Recommendation[] {
  return influential
    .filter((source) => source.sourceType === "owned" && !source.clientPresent)
    .map((source) =>
      makeRecommendation({
        actionType: "refresh_page",
        title: `Refresh ${source.domain} content used for this cluster`,
        reason: `${source.domain} is cited ${source.citations} times here, but the client is not mentioned in those answers: the page is being read without carrying the brand.`,
        estimatedImpact: impactFromShare(source.sharePct),
        effort: "low",
        sourceDomain: source.domain,
        rule: "owned-source-without-client-mention",
        ...(clusterId ? { clusterId } : {}),
        evidence: {
          sourceType: "owned",
          citations: source.citations,
          sharePct: source.sharePct,
          competitorsPresent: source.competitorsPresent,
        },
      }),
    );
}

const IMPACT_ORDER: Record<"low" | "medium" | "high", number> = { high: 0, medium: 1, low: 2 };

/** Полный набор рекомендаций, отсортированный по ожидаемому эффекту. */
export function buildRecommendations(
  diagnosis: Diagnosis,
  clusterId?: string,
): Recommendation[] {
  const all = [
    ...recommendMissingSources(diagnosis.influential, clusterId),
    ...recommendOwnedRefresh(diagnosis.influential, clusterId),
    ...recommendOwnedPage(diagnosis, clusterId),
  ];

  return all.sort(
    (a, b) =>
      IMPACT_ORDER[a.estimatedImpact] - IMPACT_ORDER[b.estimatedImpact] ||
      a.title.localeCompare(b.title),
  );
}
