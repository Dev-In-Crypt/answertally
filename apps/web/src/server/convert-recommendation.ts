import type { Recommendation } from "@repo/core";
import {
  createAction,
  findExistingAction,
  getSourceByDomain,
  listPromptClusters,
  logActivity,
  updateAction,
  type Action,
  type Database,
} from "@repo/db";

/**
 * Превращение рекомендации в работу.
 *
 * Одна функция на два входа — экран диагностики и экран возможностей. Второй
 * появился позже, и своя копия этой логики в нём означала бы два разных
 * правила дедупликации: агентство нажало бы «в работу» в двух местах и
 * получило бы две одинаковые задачи с одной причиной.
 */
export interface ConvertRecommendationInput {
  clientId: string;
  agencyId: string;
  recommendation: Recommendation;
  /** Возможность, из которой выросло действие; null — с экрана диагностики. */
  originOpportunityId?: string | null;
  /** Кластеры, которых рекомендация касается помимо своего собственного. */
  extraClusterIds?: readonly string[];
}

export async function convertRecommendationToAction(
  db: Database,
  input: ConvertRecommendationInput,
): Promise<{ action: Action; created: boolean }> {
  const { recommendation } = input;

  // Только кластеры этого клиента: идентификаторы приходят с экрана, и
  // чужой кластер в treatment-группе подмешал бы в эксперимент чужие цифры.
  const own = new Set((await listPromptClusters(db, input.clientId)).map((cluster) => cluster.id));
  const clusterIds = [
    ...new Set(
      [recommendation.clusterId, ...(input.extraClusterIds ?? [])].filter(
        (value): value is string => Boolean(value) && own.has(value as string),
      ),
    ),
  ];

  // Повторный клик по той же рекомендации не должен плодить дубли:
  // очередь действий — рабочий инструмент, а не журнал нажатий.
  const existing = await findExistingAction(
    db,
    input.clientId,
    recommendation.rule,
    recommendation.sourceDomain ?? null,
  );

  if (existing) {
    // Тот же источник, но другой кластер — это не дубль, а расширение охвата.
    // Массив кластеров задаёт treatment-группу эксперимента: потеряв кластер
    // здесь, мы измеряли бы потом не то, что делали.
    const missing = clusterIds.filter((id) => !existing.affectedClusterIds.includes(id));
    if (missing.length > 0) {
      const updated = await updateAction(db, existing.id, {
        affectedClusterIds: [...existing.affectedClusterIds, ...missing],
      });
      return { action: updated ?? existing, created: false };
    }

    return { action: existing, created: false };
  }

  const source = recommendation.sourceDomain
    ? await getSourceByDomain(db, recommendation.sourceDomain)
    : undefined;

  const action = await createAction(db, {
    clientId: input.clientId,
    title: recommendation.title,
    reason: recommendation.reason,
    actionType: recommendation.actionType,
    estimatedImpact: recommendation.estimatedImpact,
    effort: recommendation.effort,
    affectedClusterIds: clusterIds,
    sourceDomain: recommendation.sourceDomain ?? null,
    sourceId: source?.id ?? null,
    originRule: recommendation.rule,
    originOpportunityId: input.originOpportunityId ?? null,
    evidence: recommendation.evidence ?? null,
  });

  await logActivity(db, {
    agencyId: input.agencyId,
    clientId: input.clientId,
    actorUserId: null,
    eventType: "action_created",
    payload: {
      actionId: action.id,
      title: action.title,
      actionType: action.actionType,
      fromRule: recommendation.rule,
      ...(input.originOpportunityId ? { opportunityId: input.originOpportunityId } : {}),
    },
  });

  return { action, created: true };
}
