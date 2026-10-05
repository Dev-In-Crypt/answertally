import { randomUUID } from "node:crypto";
import {
  detectOpportunities,
  diagnose,
  REOPEN_DELTA_POINTS,
  SCORE_VERSION,
  type ClusterFacts,
  type DetectedOpportunity,
} from "@repo/core";
import {
  getClientById,
  listActivePromptsForClient,
  listCitationFacts,
  listPromptClusters,
  resolveOpportunitiesNotIn,
  upsertOpportunities,
  type Database,
} from "@repo/db";
import { clientVisibility, toCitationFacts } from "./read-models";

/**
 * Пересчёт возможностей клиента.
 *
 * Считается после каждого прогона и сохраняется: экран возможностей читает
 * готовые строки, а не запускает диагностику на каждый заход. Это же условие
 * делает решения человека возможными вообще — отклонить можно только то, что
 * где-то лежит.
 *
 * Все факты берутся из тех же функций, что и экраны измерений: матрицы
 * «промпт × ассистент» и диагноза по источникам. Ни одного собственного
 * определения цифр здесь нет и быть не должно.
 */

export interface GenerateOpportunitiesOutcome {
  generationId: string;
  detected: number;
  inserted: number;
  updated: number;
  resolved: number;
  skipped: "no-prompts" | "no-responses" | "no-client" | null;
}

const EMPTY: Omit<GenerateOpportunitiesOutcome, "generationId" | "skipped"> = {
  detected: 0,
  inserted: 0,
  updated: 0,
  resolved: 0,
};

export async function generateOpportunities(
  db: Database,
  clientId: string,
  options: { now?: Date; windowDays?: number } = {},
): Promise<GenerateOpportunitiesOutcome> {
  const now = options.now ?? new Date();
  const generationId = randomUUID();

  const client = await getClientById(db, clientId);
  if (!client) return { ...EMPTY, generationId, skipped: "no-client" };

  const prompts = await listActivePromptsForClient(db, clientId);
  if (prompts.length === 0) return { ...EMPTY, generationId, skipped: "no-prompts" };

  const visibility = await clientVisibility(db, client, options.windowDays ?? 28);
  if (visibility.totals.samples === 0) {
    // У клиента ещё нет ни одного измерения. Пустой список и закрытая ни одна
    // строка: «ничего не нашли» и «ещё не искали» — разные состояния, и
    // закрывать чужие находки на этом основании нельзя.
    return { ...EMPTY, generationId, skipped: "no-responses" };
  }

  const [clusters, allCitationRows] = await Promise.all([
    listPromptClusters(db, clientId),
    listCitationFacts(db, clientId),
  ]);

  /**
   * Контрольные вопросы в работу не идут. Их не трогают нарочно: по ним
   * видно, выросла видимость от работы агентства или ассистенты сдвинулись
   * сами. Совет «сделайте страницу» по контрольной теме, исполненный,
   * оставил бы эксперименты без сравнения — поэтому ни их строки матрицы,
   * ни их цитирования не порождают возможностей.
   */
  const controlIds = new Set(prompts.filter((prompt) => prompt.isControl).map((prompt) => prompt.id));
  const citationRows = allCitationRows.filter((row) => !controlIds.has(row.promptId));

  const overall = diagnose(toCitationFacts(citationRows));

  // Один проход по фактам: диагноз по каждой теме и промпты, приводящие к
  // цитированию домена. Второй запрос на кластер стоил бы полного прохода
  // по цитированиям столько раз, сколько у клиента тем.
  const rowsByCluster = new Map<string, typeof citationRows>();
  const promptIdsByDomain = new Map<string, string[]>();

  for (const row of citationRows) {
    const bucket = rowsByCluster.get(row.clusterId);
    if (bucket) bucket.push(row);
    else rowsByCluster.set(row.clusterId, [row]);

    const forDomain = promptIdsByDomain.get(row.domain);
    if (!forDomain) promptIdsByDomain.set(row.domain, [row.promptId]);
    else if (!forDomain.includes(row.promptId)) forDomain.push(row.promptId);
  }

  const promptIdsByCluster = new Map<string, string[]>();
  for (const prompt of prompts) {
    if (prompt.isControl) continue;
    const bucket = promptIdsByCluster.get(prompt.clusterId);
    if (bucket) bucket.push(prompt.id);
    else promptIdsByCluster.set(prompt.clusterId, [prompt.id]);
  }

  // Тема из одних контрольных вопросов в работу не попадает целиком.
  const clusterFacts: ClusterFacts[] = clusters
    .filter((cluster) => promptIdsByCluster.has(cluster.id))
    .map((cluster) => ({
      clusterId: cluster.id,
      clusterName: cluster.name,
      intent: cluster.intent,
      promptIds: promptIdsByCluster.get(cluster.id) ?? [],
      diagnosis: diagnose(toCitationFacts(rowsByCluster.get(cluster.id) ?? [])),
    }));

  const detected = detectOpportunities({
    matrix: { ...visibility, rows: visibility.rows.filter((row) => !controlIds.has(row.promptId)) },
    movement: visibility.movement.filter((entry) => !controlIds.has(entry.promptId)),
    overall,
    clusters: clusterFacts,
    promptIdsByDomain,
  });

  const { inserted, updated } = await upsertOpportunities(db, {
    clientId,
    generationId,
    windowStart: visibility.from,
    windowEnd: visibility.to,
    reopenDeltaPoints: REOPEN_DELTA_POINTS,
    now,
    rows: detected.map(toRow),
  });

  const resolved = await resolveOpportunitiesNotIn(db, clientId, generationId, now);

  return { generationId, detected: detected.length, inserted, updated, resolved, skipped: null };
}

function toRow(opportunity: DetectedOpportunity) {
  return {
    dedupeKey: opportunity.dedupeKey,
    kind: opportunity.kind,
    title: opportunity.title,
    reason: opportunity.reason,
    score: opportunity.score,
    scoreVersion: SCORE_VERSION,
    scoreBreakdown: opportunity.scoreBreakdown as unknown as Record<string, unknown>,
    evidenceLevel: opportunity.evidenceLevel,
    evidence: opportunity.evidence as unknown as Record<string, unknown>,
    recommendedActions: opportunity.recommendedActions as unknown as Record<string, unknown>[],
    affectedPromptIds: opportunity.affectedPromptIds,
    affectedClusterIds: opportunity.affectedClusterIds,
    competitorNames: opportunity.competitorNames,
    sourceDomain: opportunity.sourceDomain,
    sampleCount: opportunity.sampleCount,
  };
}
