import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  averageVisibility,
  estimateExperiment,
  experimentSnapshots,
  formatEstimate,
  planExperiment,
  startOfIsoWeek,
} from "@repo/core";
import {
  addExperimentEvent,
  createExperiment,
  getActionById,
  getClientById,
  getExperimentByAction,
  getExperimentById,
  listActions,
  listAllSnapshots,
  listExperimentEvents,
  listExperiments,
  listPromptClusters,
  listPromptsByClient,
} from "@repo/db";
import { assertTenant, protectedProcedure, roleProcedure, router } from "../trpc";

export const experimentsRouter = router({
  list: protectedProcedure
    .input(z.object({ clientId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const client = await getClientById(ctx.db, input.clientId);
      assertTenant(client, ctx.user.agencyId);
      const [rows, actions] = await Promise.all([
        listExperiments(ctx.db, input.clientId),
        listActions(ctx.db, input.clientId),
      ]);
      // Название действия — единственное, чем эксперименты отличаются в списке:
      // три эксперимента одной недели иначе выглядят одинаково.
      const titles = new Map(actions.map((action) => [action.id, action.title]));
      return rows.map((row) => ({ ...row, actionTitle: titles.get(row.actionId) ?? null }));
    }),

  get: protectedProcedure.input(z.object({ id: z.uuid() })).query(async ({ ctx, input }) => {
    const experiment = await getExperimentById(ctx.db, input.id);
    if (!experiment) {
      assertTenant(null, ctx.user.agencyId);
      throw new Error("unreachable");
    }
    const client = await getClientById(ctx.db, experiment.clientId);
    assertTenant(client, ctx.user.agencyId);

    const [events, snapshotRows] = await Promise.all([
      listExperimentEvents(ctx.db, experiment.id),
      listAllSnapshots(ctx.db, experiment.clientId),
    ]);

    const snapshots = experimentSnapshots(snapshotRows);

    const baselineWindow = { start: experiment.baselineStart, end: experiment.baselineEnd };
    // «После» — открытый интервал: ограничивать его текущим моментом нельзя
    // (та же причина, что в детекте событий: расхождение часов).
    const afterWindow = { start: experiment.actionDate, end: new Date("9999-12-31T00:00:00Z") };

    const treatmentBefore = averageVisibility(
      snapshots,
      experiment.treatmentClusterIds,
      baselineWindow,
    );
    const treatmentAfter = averageVisibility(
      snapshots,
      experiment.treatmentClusterIds,
      afterWindow,
    );
    const controlBefore = averageVisibility(snapshots, experiment.controlClusterIds, baselineWindow);
    const controlAfter = averageVisibility(snapshots, experiment.controlClusterIds, afterWindow);

    const estimate = estimateExperiment({
      treatmentBefore: treatmentBefore.visibilityPct,
      treatmentAfter: treatmentAfter.visibilityPct,
      controlBefore: controlBefore.visibilityPct,
      controlAfter: controlAfter.visibilityPct,
      treatmentSamplesAfter: treatmentAfter.samples,
      baselineSnapshots: treatmentBefore.snapshots,
      hasControlGroup: experiment.controlClusterIds.length > 0,
      hasNewCitation: events.some((event) => event.type === "first_new_citation"),
    });

    /**
     * Ряды для графика: лечёная и контрольная группы по неделям.
     *
     * Ось — начала ISO-недель, поэтому дата действия тоже приводится к своей
     * неделе и всегда есть среди категорий: иначе пунктир «до/после» пропадает
     * у любого действия, завершённого не в понедельник.
     */
    const actionWeek = startOfIsoWeek(experiment.actionDate).toISOString();
    const weeks = [
      ...new Set([...snapshots.map((point) => point.periodStart.toISOString()), actionWeek]),
    ].sort();
    const series = weeks.map((week) => {
      const weekStart = new Date(week);
      const forGroup = (clusterIds: string[]): number | null => {
        const points = snapshots.filter(
          (point) =>
            point.clusterId !== null &&
            clusterIds.includes(point.clusterId) &&
            point.periodStart.getTime() === weekStart.getTime(),
        );
        if (points.length === 0) return null;
        const samples = points.reduce((sum, p) => sum + p.sampleCount, 0);
        if (samples === 0) return null;
        return (
          Math.round(
            (points.reduce((sum, p) => sum + p.clientVisibilityPct * p.sampleCount, 0) / samples) *
              10,
          ) / 10
        );
      };

      return {
        week: week.slice(0, 10),
        treatment: forGroup(experiment.treatmentClusterIds),
        control: forGroup(experiment.controlClusterIds),
      };
    });

    return {
      experiment,
      events,
      estimate,
      series,
      actionWeek: actionWeek.slice(0, 10),
      formattedEstimate: formatEstimate(estimate),
      /**
       * Обе группы целиком: до, после и на скольких ответах.
       *
       * Без размеров выборки движение читается как результат, а «+9 pp на
       * двенадцати ответах» и «+9 pp на двухстах» — разные утверждения.
       * Экран обязан показывать оба конца сравнения, а не только вывод.
       */
      groups: {
        treatment: {
          beforePct: treatmentBefore.visibilityPct,
          afterPct: treatmentAfter.visibilityPct,
          samplesBefore: treatmentBefore.samples,
          samplesAfter: treatmentAfter.samples,
          sufficient: treatmentAfter.sufficient,
          clusters: experiment.treatmentClusterIds.length,
        },
        control: {
          beforePct: controlBefore.visibilityPct,
          afterPct: controlAfter.visibilityPct,
          samplesBefore: controlBefore.samples,
          samplesAfter: controlAfter.samples,
          sufficient: controlAfter.sufficient,
          clusters: experiment.controlClusterIds.length,
        },
      },
      baselineWindow,
    };
  }),

  /**
   * Создаёт эксперимент из завершённого действия и сразу фиксирует baseline.
   * Baseline считается на момент создания намеренно: через несколько недель
   * период «до» уже не восстановить — данные смешаются.
   */
  createFromAction: roleProcedure("member")
    .input(z.object({ actionId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const action = await getActionById(ctx.db, input.actionId);
      if (!action) {
        assertTenant(null, ctx.user.agencyId);
        throw new Error("unreachable");
      }
      const client = await getClientById(ctx.db, action.clientId);
      assertTenant(client, ctx.user.agencyId);

      if (!action.completedAt) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Complete the action first — the experiment needs a date to measure from.",
        });
      }

      const existing = await getExperimentByAction(ctx.db, action.id);
      if (existing) {
        return { experiment: existing, created: false, warnings: [] as string[] };
      }

      const [clusters, allPrompts, snapshotRows] = await Promise.all([
        listPromptClusters(ctx.db, action.clientId),
        listPromptsByClient(ctx.db, action.clientId),
        listAllSnapshots(ctx.db, action.clientId),
      ]);

      const snapshots = experimentSnapshots(snapshotRows);

      // Если действие не привязано к кластерам, лечим весь набор как treatment:
      // это слабее, но честнее, чем выбрать кластер за агентство.
      const treatmentClusterIds =
        action.affectedClusterIds.length > 0
          ? action.affectedClusterIds
          : clusters.map((cluster) => cluster.id);

      const plan = planExperiment(
        action.completedAt,
        clusters.map((cluster) => cluster.id),
        treatmentClusterIds,
        snapshots,
      );

      const experiment = await createExperiment(ctx.db, {
        clientId: action.clientId,
        actionId: action.id,
        actionDate: action.completedAt,
        baselineStart: plan.window.start,
        baselineEnd: plan.window.end,
        treatmentClusterIds: plan.treatmentClusterIds,
        controlClusterIds: plan.controlClusterIds,
        controlPromptIds: allPrompts.filter((p) => p.isControl).map((p) => p.id),
        status: "collecting",
      });

      await addExperimentEvent(ctx.db, {
        experimentId: experiment.id,
        type: "action_shipped",
        occurredAt: action.completedAt,
        note: action.title,
        payload: {
          baselineVisibilityPct: plan.treatment.visibilityPct,
          controlVisibilityPct: plan.control.visibilityPct,
          baselineSnapshots: plan.treatment.snapshots,
        },
      });

      // Предупреждения о слабых местах отдаются наружу, а не остаются в логах:
      // агентство должно знать, насколько шатка база сравнения.
      return { experiment, created: true, warnings: plan.warnings };
    }),

  addNote: roleProcedure("member")
    .input(z.object({ experimentId: z.uuid(), note: z.string().min(1).max(1000) }))
    .mutation(async ({ ctx, input }) => {
      const experiment = await getExperimentById(ctx.db, input.experimentId);
      if (!experiment) {
        assertTenant(null, ctx.user.agencyId);
        throw new Error("unreachable");
      }
      const client = await getClientById(ctx.db, experiment.clientId);
      assertTenant(client, ctx.user.agencyId);

      await addExperimentEvent(ctx.db, {
        experimentId: experiment.id,
        type: "note",
        occurredAt: new Date(),
        note: input.note,
      });

      return { ok: true };
    }),
});
