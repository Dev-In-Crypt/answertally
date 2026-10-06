import {
  MIN_SOURCES_FOR_STATEMENT,
  type Diagnosis,
  type InfluentialSource,
} from "../diagnosis/source-graph";
import {
  makeRecommendation,
  recommendMissingSources,
  recommendOwnedPage,
  recommendOwnedRefresh,
  type ActionType,
  type Recommendation,
} from "../diagnosis/recommendations";
import type { MatrixMovement, MatrixRow, PromptMatrix } from "../metrics/matrix";
import { meetsSampleFloor } from "../metrics/confidence";
import type { PromptIntent } from "../import/csv";
import { INTENT_WEIGHT, scoreOpportunity, type ScoreInputs } from "./score";
import {
  dedupeKeyFor,
  makeDetectedOpportunity,
  type DetectedOpportunity,
  type OpportunityEvidence,
} from "./types";

/**
 * Детекторы возможностей.
 *
 * Каждый — чистая функция над структурами, которые продукт уже считает:
 * матрицей «промпт × ассистент» и диагнозом по источникам. Ни один не выводит
 * факт заново — иначе в системе появилось бы второе определение тех же цифр,
 * и экран возможностей начал бы спорить с экраном измерений.
 *
 * Пороги вынесены в константы и покрыты таблицами тестов: они продуктовые
 * решения, а не подобранные на глаз числа внутри условия.
 */

/** Отставание от сильнейшего конкурента, ниже которого это шум, а не разрыв. */
export const COMPETITOR_GAP_MIN_PP = 15;

/** Доля цитирований, ниже которой источник не влияет на ответы заметно. */
export const SOURCE_GAP_MIN_SHARE_PCT = 5;

/** Отставание кластера от общего уровня клиента. */
export const CLUSTER_GAP_MIN_PP = 12;

/** Кластер из одного промпта — это промпт; для него работает свой детектор. */
export const CLUSTER_GAP_MIN_PROMPTS = 2;

/**
 * Верхняя граница списка. Сорок возможностей — уже не приоритеты, а бэклог;
 * ниже сорокового места агентство всё равно не дойдёт.
 */
export const MAX_OPPORTUNITIES = 40;

export interface ClusterFacts {
  clusterId: string;
  clusterName: string;
  intent: PromptIntent;
  promptIds: readonly string[];
  diagnosis: Diagnosis;
}

export interface DetectorInput {
  matrix: PromptMatrix;
  movement: readonly MatrixMovement[];
  /** Диагноз по всем ответам клиента за окно. */
  overall: Diagnosis;
  clusters: readonly ClusterFacts[];
  /**
   * Какие промпты приводят к цитированию домена. Считается вызывающим кодом
   * из фактов цитирования: без этого «затрагивает 17 вопросов» было бы
   * оценкой сверху по кластеру, а не измеренным числом.
   */
  promptIdsByDomain: ReadonlyMap<string, readonly string[]>;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

function list(names: readonly string[]): string {
  if (names.length <= 2) return names.join(" and ");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

const IMPACT_RANK: Record<"low" | "medium" | "high", number> = { high: 0, medium: 1, low: 2 };

/** Самая весомая рекомендация из набора, либо null, если набор пуст. */
function strongest(recommendations: readonly Recommendation[]): Recommendation | null {
  if (recommendations.length === 0) return null;
  return [...recommendations].sort(
    (a, b) =>
      IMPACT_RANK[a.estimatedImpact] - IMPACT_RANK[b.estimatedImpact] ||
      a.title.localeCompare(b.title),
  )[0] as Recommendation;
}

function assemble(params: {
  kind: DetectedOpportunity["kind"];
  dedupeKey: string;
  title: string;
  reason: string;
  evidence: OpportunityEvidence;
  recommendations: readonly Recommendation[];
  affectedPromptIds: readonly string[];
  affectedClusterIds: readonly string[];
  competitorNames: readonly string[];
  sourceDomain: string | null;
  scoreInputs: ScoreInputs;
}): DetectedOpportunity {
  const breakdown = scoreOpportunity(params.scoreInputs);

  return makeDetectedOpportunity({
    kind: params.kind,
    dedupeKey: params.dedupeKey,
    title: params.title,
    reason: params.reason,
    score: breakdown.score,
    priority: breakdown.priority,
    scoreBreakdown: breakdown,
    // Уровень доказательности — это уровень уверенности выборки, а не
    // отдельная шкала: разводить их значило бы завести второе мнение о том же.
    evidenceLevel: breakdown.confidenceLevel,
    evidence: params.evidence,
    recommendedActions: [...params.recommendations],
    affectedPromptIds: [...params.affectedPromptIds],
    affectedClusterIds: [...params.affectedClusterIds],
    competitorNames: [...params.competitorNames],
    sourceDomain: params.sourceDomain,
    sampleCount: params.scoreInputs.samples,
  });
}

/**
 * Правило 1. Конкурента называют заметно чаще клиента.
 *
 * Группируется парой «тема + конкурент», а не отдельным вопросом. Один
 * конкурент, обходящий клиента на трёх вопросах одной темы, — это одна работа;
 * тремя строками с разной оценкой список превращается в поток одинаковых
 * заголовков, который перестают читать после второго.
 */
export function detectCompetitorGaps(input: DetectorInput): DetectedOpportunity[] {
  const byCluster = new Map(input.clusters.map((cluster) => [cluster.clusterId, cluster]));
  const movementByPrompt = new Map(input.movement.map((entry) => [entry.promptId, entry]));

  /** Строки, прошедшие порог, сложенные по паре «тема + конкурент». */
  const groups = new Map<string, { cluster: ClusterFacts; competitor: string; rows: MatrixRow[] }>();

  for (const row of input.matrix.rows) {
    if (!row.sufficient || row.competitorTop === null) continue;

    const gapPp = round1(row.competitorTop.pct - (row.ratePct ?? 0));
    if (gapPp < COMPETITOR_GAP_MIN_PP) continue;

    const cluster = byCluster.get(row.clusterId);
    if (!cluster) continue;

    const key = `${cluster.clusterId}:${row.competitorTop.name}`;
    const group = groups.get(key);
    if (group) group.rows.push(row);
    else groups.set(key, { cluster, competitor: row.competitorTop.name, rows: [row] });
  }

  const found: DetectedOpportunity[] = [];

  for (const { cluster, competitor, rows } of groups.values()) {
    // Доли по группе — взвешенные по числу ответов: вопрос, спрошенный трижды,
    // не весит столько же, сколько спрошенный тридцать раз.
    const samples = rows.reduce((total, row) => total + row.samples, 0);
    const clientPct = round1(
      (rows.reduce((total, row) => total + ((row.ratePct ?? 0) / 100) * row.samples, 0) / samples) *
        100,
    );
    const competitorPct = round1(
      (rows.reduce(
        (total, row) => total + ((row.competitorTop?.pct ?? 0) / 100) * row.samples,
        0,
      ) /
        samples) *
        100,
    );
    const gapPp = round1(competitorPct - clientPct);

    const questions = rows.length === 1 ? "question" : "questions";
    const recommendation =
      strongest(clusterRecommendations(cluster)) ??
      makeRecommendation({
        actionType: "create_page",
        title: `Answer "${cluster.clusterName}" on a page of your own`,
        reason: `${competitor} is named in ${competitorPct}% of answers to ${rows.length} ${questions} in this topic; the client in ${clientPct}%.`,
        estimatedImpact: gapPp >= 30 ? "high" : "medium",
        effort: "medium",
        rule: "competitor-ahead-on-prompt",
        clusterId: cluster.clusterId,
        evidence: { competitorsPresent: [competitor] },
      });

    // Ячейки ассистентов складываются по группе: иначе «на чём измерено»
    // отвечало бы за один вопрос, а число сверху — за все.
    const cells = new Map<string, { samples: number; named: number; competitorOnly: boolean }>();
    for (const row of rows) {
      for (const cell of row.cells) {
        if (!cell.measurable) continue;
        const entry = cells.get(cell.assistantId) ?? { samples: 0, named: 0, competitorOnly: false };
        entry.samples += cell.samples;
        entry.named += ((cell.ratePct ?? 0) / 100) * cell.samples;
        entry.competitorOnly = entry.competitorOnly || cell.competitorOnly;
        cells.set(cell.assistantId, entry);
      }
    }

    const title =
      rows.length === 1
        ? `Losing "${rows[0]!.promptText}" to ${competitor}`
        : `Losing ${rows.length} ${questions} in "${cluster.clusterName}" to ${competitor}`;

    found.push(
      assemble({
        kind: "competitor_gap",
        dedupeKey: dedupeKeyFor({
          kind: "competitor_gap",
          clusterId: cluster.clusterId,
          competitor,
        }),
        title,
        reason: `${competitor} is named in ${competitorPct}% of sampled answers to ${rows.length} tracked ${questions} here, the client in ${clientPct}%: ${gapPp} pp behind across ${samples} answers.`,
        evidence: {
          kind: "competitor_gap",
          clusterId: cluster.clusterId,
          clusterName: cluster.clusterName,
          competitorName: competitor,
          clientPct,
          competitorPct,
          gapPp,
          samples,
          prompts: rows.map((row) => ({
            promptId: row.promptId,
            promptText: row.promptText,
            clientPct: row.ratePct,
            competitorPct: row.competitorTop?.pct ?? 0,
            gapPp: round1((row.competitorTop?.pct ?? 0) - (row.ratePct ?? 0)),
            samples: row.samples,
            deltaPp: movementByPrompt.get(row.promptId)?.deltaPp ?? null,
            distinguishable: movementByPrompt.get(row.promptId)?.distinguishable ?? false,
          })),
          assistants: [...cells.entries()]
            .map(([assistantId, entry]) => ({
              assistantId,
              samples: entry.samples,
              ratePct: entry.samples > 0 ? round1((entry.named / entry.samples) * 100) : null,
              competitorOnly: entry.competitorOnly,
            }))
            .sort((a, b) => a.assistantId.localeCompare(b.assistantId)),
        },
        recommendations: [recommendation],
        affectedPromptIds: rows.map((row) => row.promptId),
        affectedClusterIds: [cluster.clusterId],
        competitorNames: [competitor],
        sourceDomain: recommendation.sourceDomain ?? null,
        scoreInputs: {
          gapPp,
          affectedPromptCount: rows.length,
          totalActivePromptCount: input.matrix.rows.length,
          intent: cluster.intent,
          samples,
          actionType: recommendation.actionType,
        },
      }),
    );
  }

  return found;
}

/** Рекомендации кластера — те же три правила, что и на экране диагностики. */
function clusterRecommendations(cluster: ClusterFacts): Recommendation[] {
  return [
    ...recommendMissingSources(cluster.diagnosis.influential, cluster.clusterId),
    ...recommendOwnedRefresh(cluster.diagnosis.influential, cluster.clusterId),
    ...recommendOwnedPage(cluster.diagnosis, cluster.clusterId),
  ];
}

/**
 * Правило 2. Источник, который модели читают, конкуренты в нём есть, клиента
 * нет. Самая частая причина разрыва — и та, где ход очевиден.
 */
export function detectSourceGaps(input: DetectorInput): DetectedOpportunity[] {
  // Ниже пяти влиятельных источников модуль диагностики отказывается делать
  // вывод; здесь действует тот же порог, чтобы два экрана не расходились.
  if (input.overall.gap.totalInfluential < MIN_SOURCES_FOR_STATEMENT) return [];

  const found: DetectedOpportunity[] = [];

  for (const source of input.overall.gap.missingFrom) {
    if (source.sharePct < SOURCE_GAP_MIN_SHARE_PCT) continue;

    const clusters = input.clusters.filter((cluster) =>
      cluster.diagnosis.influential.some((entry) => entry.domain === source.domain),
    );
    const promptIds = input.promptIdsByDomain.get(source.domain) ?? [];

    const recommendation =
      strongest(recommendMissingSources([source])) ??
      makeRecommendation({
        actionType: "source_outreach",
        title: `Get the client covered on ${source.domain}`,
        reason: `${source.domain} is cited in ${source.sharePct}% of answers (${source.citations} citations). ${list(source.competitorsPresent)} appear in those answers; the client does not.`,
        estimatedImpact: source.sharePct >= 15 ? "high" : "medium",
        effort: "medium",
        sourceDomain: source.domain,
        rule: "missing-from-influential-source",
        evidence: {
          citations: source.citations,
          sharePct: source.sharePct,
          competitorsPresent: source.competitorsPresent,
        },
      });

    found.push(
      assemble({
        kind: "source_gap",
        dedupeKey: dedupeKeyFor({ kind: "source_gap", domain: source.domain }),
        title: `Absent from ${source.domain}`,
        reason: `${source.domain} is cited in ${source.sharePct}% of the answers measured for this client (${source.citations} citations). ${list(source.competitorsPresent)} appear in those answers; the client does not.`,
        evidence: {
          kind: "source_gap",
          domain: source.domain,
          sourceType: source.sourceType,
          citations: source.citations,
          sharePct: source.sharePct,
          competitorsPresent: source.competitorsPresent,
          influentialCount: input.overall.gap.totalInfluential,
          clusters: clusters.map((cluster) => ({
            clusterId: cluster.clusterId,
            clusterName: cluster.clusterName,
          })),
          samples: source.citations,
        },
        recommendations: [recommendation],
        affectedPromptIds: promptIds,
        affectedClusterIds: clusters.map((cluster) => cluster.clusterId),
        competitorNames: source.competitorsPresent,
        sourceDomain: source.domain,
        scoreInputs: {
          sharePct: source.sharePct,
          affectedPromptCount: promptIds.length,
          totalActivePromptCount: input.matrix.rows.length,
          intent: heaviestIntent(clusters),
          samples: source.citations,
          actionType: recommendation.actionType,
        },
      }),
    );
  }

  return found;
}

/** Самый коммерчески весомый интент среди затронутых кластеров. */
function heaviestIntent(clusters: readonly ClusterFacts[]): PromptIntent {
  let best: PromptIntent = "other";
  for (const cluster of clusters) {
    if (INTENT_WEIGHT[cluster.intent] > INTENT_WEIGHT[best]) best = cluster.intent;
  }
  return best;
}

/**
 * Правило 3. Разрыв на собственном контенте — в двух видах: страницы клиента
 * не цитируют вовсе, либо цитируют, но бренд в этих ответах не называют.
 */
export function detectContentGaps(input: DetectorInput): DetectedOpportunity[] {
  const found: DetectedOpportunity[] = [];
  const seenOwnedDomains = new Set<string>();

  for (const cluster of input.clusters) {
    const samples = clusterSamples(input.matrix, cluster);

    // (а) своей страницы среди цитируемых нет вообще.
    const ownedPage = strongest(recommendOwnedPage(cluster.diagnosis, cluster.clusterId));
    if (ownedPage && cluster.diagnosis.gap.totalInfluential >= MIN_SOURCES_FOR_STATEMENT) {
      const top = cluster.diagnosis.influential.slice(0, 5);

      found.push(
        assemble({
          kind: "content_gap",
          dedupeKey: dedupeKeyFor({ kind: "content_gap", clusterId: cluster.clusterId }),
          title: `No page of your own answers "${cluster.clusterName}"`,
          reason: `None of the ${cluster.diagnosis.gap.totalInfluential} sources cited for this topic belong to the client's own domain. Models answer it entirely from other people's pages.`,
          evidence: {
            kind: "content_gap",
            variant: "no_owned_page",
            clusterId: cluster.clusterId,
            clusterName: cluster.clusterName,
            domain: null,
            citations: 0,
            sharePct: 0,
            influentialCount: cluster.diagnosis.gap.totalInfluential,
            topDomains: top.map((entry) => ({ domain: entry.domain, sharePct: entry.sharePct })),
            samples,
          },
          recommendations: [ownedPage],
          affectedPromptIds: cluster.promptIds,
          affectedClusterIds: [cluster.clusterId],
          competitorNames: uniqueCompetitors(top),
          sourceDomain: null,
          scoreInputs: {
            // Величина — доля цитирований, которая проходит мимо клиента,
            // то есть весь объём темы.
            sharePct: 100,
            affectedPromptCount: cluster.promptIds.length,
            totalActivePromptCount: input.matrix.rows.length,
            intent: cluster.intent,
            samples,
            actionType: ownedPage.actionType,
          },
        }),
      );
    }

    // (б) своя страница цитируется, но бренд в этих ответах не назван.
    for (const recommendation of recommendOwnedRefresh(
      cluster.diagnosis.influential,
      cluster.clusterId,
    )) {
      const domain = recommendation.sourceDomain;
      if (!domain || seenOwnedDomains.has(domain)) continue;
      seenOwnedDomains.add(domain);

      const source = cluster.diagnosis.influential.find((entry) => entry.domain === domain);
      if (!source) continue;

      const promptIds = input.promptIdsByDomain.get(domain) ?? cluster.promptIds;

      found.push(
        assemble({
          kind: "content_gap",
          dedupeKey: dedupeKeyFor({ kind: "content_gap", domain }),
          title: `${domain} is read but does not carry the brand`,
          reason: `${domain} is cited ${source.citations} times (${source.sharePct}% of citations here), but the client is not named in those answers: the page is being read without carrying the brand.`,
          evidence: {
            kind: "content_gap",
            variant: "owned_without_brand",
            clusterId: cluster.clusterId,
            clusterName: cluster.clusterName,
            domain,
            citations: source.citations,
            sharePct: source.sharePct,
            influentialCount: cluster.diagnosis.gap.totalInfluential,
            topDomains: [{ domain, sharePct: source.sharePct }],
            samples: source.citations,
          },
          recommendations: [recommendation],
          affectedPromptIds: promptIds,
          affectedClusterIds: [cluster.clusterId],
          competitorNames: source.competitorsPresent,
          sourceDomain: domain,
          scoreInputs: {
            sharePct: source.sharePct,
            affectedPromptCount: promptIds.length,
            totalActivePromptCount: input.matrix.rows.length,
            intent: cluster.intent,
            samples: source.citations,
            actionType: recommendation.actionType,
          },
        }),
      );
    }
  }

  return found;
}

function uniqueCompetitors(sources: readonly InfluentialSource[]): string[] {
  const names = new Set<string>();
  for (const source of sources) {
    for (const name of source.competitorsPresent) names.add(name);
  }
  return [...names].sort();
}

function clusterRows(matrix: PromptMatrix, cluster: ClusterFacts): MatrixRow[] {
  return matrix.rows.filter((row) => row.clusterId === cluster.clusterId);
}

function clusterSamples(matrix: PromptMatrix, cluster: ClusterFacts): number {
  return clusterRows(matrix, cluster).reduce((total, row) => total + row.samples, 0);
}

/**
 * Правило 4. Целая тема проседает относительно остального набора вопросов.
 * Отдельные промпты по ней могут быть не провальными, а тема — да.
 */
export function detectClusterGaps(input: DetectorInput): DetectedOpportunity[] {
  const overallPct = input.matrix.totals.ratePct;
  if (overallPct === null) return [];

  const found: DetectedOpportunity[] = [];

  for (const cluster of input.clusters) {
    const rows = clusterRows(input.matrix, cluster);
    if (rows.length < CLUSTER_GAP_MIN_PROMPTS) continue;

    const samples = rows.reduce((total, row) => total + row.samples, 0);
    if (!meetsSampleFloor(samples)) continue;

    // Взвешенно по числу ответов: промпт, который спросили трижды, не весит
    // столько же, сколько спрошенный тридцать раз.
    const named = rows.reduce(
      (total, row) => total + ((row.ratePct ?? 0) / 100) * row.samples,
      0,
    );
    const clusterPct = round1((named / samples) * 100);
    const gapPp = round1(overallPct - clusterPct);
    if (gapPp < CLUSTER_GAP_MIN_PP) continue;

    const recommendation =
      strongest(clusterRecommendations(cluster)) ??
      makeRecommendation({
        actionType: "create_page",
        title: `Cover "${cluster.clusterName}" with a page of your own`,
        reason: `The client is named in ${clusterPct}% of answers on this topic against ${overallPct}% across all tracked questions.`,
        estimatedImpact: gapPp >= 25 ? "high" : "medium",
        effort: "medium",
        rule: "cluster-behind-overall",
        clusterId: cluster.clusterId,
        evidence: { competitorsPresent: [] },
      });

    found.push(
      assemble({
        kind: "cluster_gap",
        dedupeKey: dedupeKeyFor({ kind: "cluster_gap", clusterId: cluster.clusterId }),
        title: `"${cluster.clusterName}" trails the rest of the set`,
        reason: `The client is named in ${clusterPct}% of answers on this topic against ${overallPct}% across all tracked questions, ${gapPp} pp lower on ${samples} answers.`,
        evidence: {
          kind: "cluster_gap",
          clusterId: cluster.clusterId,
          clusterName: cluster.clusterName,
          clusterPct,
          overallPct,
          gapPp,
          prompts: rows.map((row) => ({
            promptId: row.promptId,
            promptText: row.promptText,
            ratePct: row.ratePct,
            samples: row.samples,
          })),
          samples,
        },
        recommendations: [recommendation],
        affectedPromptIds: rows.map((row) => row.promptId),
        affectedClusterIds: [cluster.clusterId],
        competitorNames: uniqueCompetitors(cluster.diagnosis.influential),
        sourceDomain: recommendation.sourceDomain ?? null,
        scoreInputs: {
          gapPp,
          affectedPromptCount: rows.length,
          totalActivePromptCount: input.matrix.rows.length,
          intent: cluster.intent,
          samples,
          actionType: recommendation.actionType,
        },
      }),
    );
  }

  return found;
}

const KIND_ORDER: Record<DetectedOpportunity["kind"], number> = {
  content_gap: 0,
  source_gap: 1,
  competitor_gap: 2,
  cluster_gap: 3,
};

/**
 * Полный набор, отсортированный и без повторов по смыслу.
 *
 * Если по большинству промптов кластера уже сработал разрыв против
 * конкурента, отдельная возможность «тема отстаёт» — та же новость во второй
 * раз, только с другой оценкой. Две записи об одном хуже любой одной.
 */
export function detectOpportunities(input: DetectorInput): DetectedOpportunity[] {
  const competitorGaps = detectCompetitorGaps(input);
  const clusterGaps = detectClusterGaps(input);

  // Считаются охваченные вопросы, а не число находок: после группировки одна
  // находка может закрывать всю тему целиком.
  const coveredPrompts = new Map<string, Set<string>>();
  for (const gap of competitorGaps) {
    for (const clusterId of gap.affectedClusterIds) {
      const set = coveredPrompts.get(clusterId) ?? new Set<string>();
      for (const promptId of gap.affectedPromptIds) set.add(promptId);
      coveredPrompts.set(clusterId, set);
    }
  }

  const promptsPerCluster = new Map(
    input.clusters.map((cluster) => [
      cluster.clusterId,
      input.matrix.rows.filter((row) => row.clusterId === cluster.clusterId).length,
    ]),
  );

  const keptClusterGaps = clusterGaps.filter((gap) => {
    const clusterId = gap.affectedClusterIds[0];
    if (!clusterId) return true;
    const covered = coveredPrompts.get(clusterId)?.size ?? 0;
    const total = promptsPerCluster.get(clusterId) ?? 0;
    return total === 0 || covered * 2 < total;
  });

  const all = [
    ...detectContentGaps(input),
    ...detectSourceGaps(input),
    ...competitorGaps,
    ...keptClusterGaps,
  ];

  // Порядок обязан быть устойчивым: список, который переставляется между
  // одинаковыми прогонами, нельзя ни читать, ни тестировать.
  return all
    .sort(
      (a, b) =>
        b.score - a.score ||
        KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
        a.dedupeKey.localeCompare(b.dedupeKey),
    )
    .slice(0, MAX_OPPORTUNITIES);
}

export type { ActionType };
