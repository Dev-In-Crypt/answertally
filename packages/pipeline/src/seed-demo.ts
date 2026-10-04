import { experimentSnapshots, planExperiment, recommendationSchema } from "@repo/core";
import {
  addExperimentEvent,
  createAction,
  createDb,
  createExperiment,
  createRun,
  getScheduleForClient,
  listActions,
  listAllSnapshots,
  listOpportunities,
  listPromptClusters,
  listRunsByClient,
  SEED_CLIENT_ACME_ID,
  type Database,
} from "@repo/db";
import { completeRun } from "./complete-run";
import { generateOpportunities } from "./opportunity-job";

/**
 * Демонстрационные данные: один настоящий прогон на фикстурах.
 *
 * Числа на новых экранах не вписаны руками. Прогон идёт тем же конвейером,
 * что и в бою, — разбор, классификация источников, срезы, возможности; на
 * фикстурах отличается только источник ответов. Вписанные руками цифры
 * разошлись бы с тем, что посчитал бы движок, и демо показывало бы то, чего
 * продукт не делает.
 *
 * Живёт здесь, а не в `@repo/db`: конвейер зависит от базы, и обратная
 * зависимость замкнула бы пакеты в цикл.
 */

export interface SeedDemoOutcome {
  skipped: boolean;
  responses: number;
  snapshots: number;
  opportunities: number;
  actions: number;
}

export async function seedDemoMeasurement(
  db: Database,
  clientId: string = SEED_CLIENT_ACME_ID,
): Promise<SeedDemoOutcome> {
  const existing = await listRunsByClient(db, clientId);
  if (existing.some((run) => run.status === "done")) {
    // Демо идемпотентно: повторный прогон стоил бы времени и ничего бы не
    // изменил, а расписание всё равно продолжит измерять само. Возможности
    // при этом досчитываются: измерения могли быть сделаны до того, как их
    // вообще научились считать.
    await generateOpportunities(db, clientId);

    const [opportunities, actions] = await Promise.all([
      listOpportunities(db, clientId),
      listActions(db, clientId),
    ]);
    return {
      skipped: true,
      responses: 0,
      snapshots: 0,
      opportunities: opportunities.length,
      actions: actions.length,
    };
  }

  const schedule = await getScheduleForClient(db, clientId);
  const run = await createRun(db, {
    clientId,
    scheduleId: schedule?.id ?? null,
    trigger: "manual",
  });

  const outcome = await completeRun(db, run.id, clientId, "mock");
  await seedDemoWork(db, clientId);

  const opportunities = await listOpportunities(db, clientId);
  const actions = await listActions(db, clientId);

  return {
    skipped: false,
    responses: outcome.responses,
    snapshots: outcome.snapshots,
    opportunities: opportunities.length,
    actions: actions.length,
  };
}

/**
 * Работа поверх находок: две задачи из двух верхних возможностей, одна из них
 * закрыта, и на ней — эксперимент.
 *
 * Демо должно показывать не список находок, а путь: возможность → работа →
 * измерение движения. Задачи собираются из тех же рекомендаций, которые
 * посчитал движок, а не выдумываются отдельно.
 */
async function seedDemoWork(db: Database, clientId: string): Promise<void> {
  const opportunities = (await listOpportunities(db, clientId)).slice(0, 2);
  if (opportunities.length === 0) return;

  const clusters = await listPromptClusters(db, clientId);
  // Тот же отбор строк, что у настоящего эксперимента: ручной перебор брал и
  // строки по платформам, и общие — baseline демо считал ответы дважды.
  const snapshots = experimentSnapshots(await listAllSnapshots(db, clientId));

  // Действие закрыто три недели назад: у эксперимента должен быть baseline
  // до работы и хоть какие-то измерения после неё.
  const actionDate = new Date(Date.now() - 21 * 86_400_000);

  for (const [index, opportunity] of opportunities.entries()) {
    const recommendation = recommendationSchema.safeParse(opportunity.recommendedActions[0]);
    if (!recommendation.success) continue;

    const action = await createAction(db, {
      clientId,
      title: recommendation.data.title,
      reason: recommendation.data.reason,
      actionType: recommendation.data.actionType,
      estimatedImpact: recommendation.data.estimatedImpact,
      effort: recommendation.data.effort,
      affectedClusterIds: opportunity.affectedClusterIds,
      sourceDomain: recommendation.data.sourceDomain ?? null,
      originRule: recommendation.data.rule,
      originOpportunityId: opportunity.id,
      evidence: recommendation.data.evidence ?? null,
      // Первая уже сделана, вторая ещё в очереди — оба состояния нужны на экране.
      status: index === 0 ? "done" : "backlog",
      completedAt: index === 0 ? actionDate : null,
    });

    if (index !== 0) continue;

    const plan = planExperiment(
      actionDate,
      clusters.map((cluster) => cluster.id),
      opportunity.affectedClusterIds,
      snapshots,
    );

    const experiment = await createExperiment(db, {
      clientId,
      actionId: action.id,
      actionDate,
      baselineStart: plan.window.start,
      baselineEnd: plan.window.end,
      treatmentClusterIds: plan.treatmentClusterIds,
      controlClusterIds: plan.controlClusterIds,
      controlPromptIds: [],
      status: "collecting",
    });

    await addExperimentEvent(db, {
      experimentId: experiment.id,
      type: "action_shipped",
      occurredAt: actionDate,
      note: action.title,
    });
  }
}

async function main(): Promise<void> {
  const { db, close } = createDb();
  try {
    const outcome = await seedDemoMeasurement(db);
    if (outcome.skipped) {
      console.log(
        `[demo] Already measured: ${outcome.opportunities} opportunities, ${outcome.actions} actions.`,
      );
      return;
    }
    console.log(
      `[demo] ${outcome.responses} answers, ${outcome.snapshots} snapshots, ${outcome.opportunities} opportunities.`,
    );
  } finally {
    await close();
  }
}

const isDirectRun = process.argv[1]?.replace(/\\/g, "/").endsWith("/seed-demo.ts") ?? false;
if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error("[demo] Seed failed:", error);
    process.exit(1);
  });
}
