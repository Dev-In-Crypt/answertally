import { z } from "zod";
import {
  ACTION_TYPES,
  checkSourceOutcome,
  recommendationEvidenceSchema,
  recommendationSchema,
  TemplateBriefWriter,
} from "@repo/core";
import {
  createAction,
  deleteAction,
  getActionById,
  getClientById,
  getSourceByDomain,
  listActions,
  listActivity,
  listDatedCitationFacts,
  listUsersByAgency,
  logActivity,
  updateAction,
} from "@repo/db";
import { TRPCError } from "@trpc/server";
import { assertTenant, protectedProcedure, roleProcedure, router } from "../trpc";
import { convertRecommendationToAction } from "../../convert-recommendation";

const IMPACT = ["low", "medium", "high"] as const;
const STATUS = ["backlog", "in_progress", "done", "dropped"] as const;

export const actionsRouter = router({
  activity: protectedProcedure
    .input(z.object({ clientId: z.uuid(), limit: z.number().int().min(1).max(100).default(20) }))
    .query(async ({ ctx, input }) => {
      const client = await getClientById(ctx.db, input.clientId);
      assertTenant(client, ctx.user.agencyId);
      return listActivity(ctx.db, input.clientId, input.limit);
    }),

  list: protectedProcedure
    .input(z.object({ clientId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const client = await getClientById(ctx.db, input.clientId);
      assertTenant(client, ctx.user.agencyId);
      return listActions(ctx.db, input.clientId);
    }),

  /**
   * Рабочее задание по действию.
   *
   * Собирается на лету и нигде не хранится: бриф детерминирован из действия
   * и плейбука, а лишняя копия текста в базе однажды разойдётся с рецептом.
   */
  brief: protectedProcedure
    .input(z.object({ actionId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const action = await getActionById(ctx.db, input.actionId);
      if (!action) {
        assertTenant(null, ctx.user.agencyId);
        throw new Error("unreachable");
      }

      const client = await getClientById(ctx.db, action.clientId);
      assertTenant(client, ctx.user.agencyId);

      // Доказательства пришли из jsonb: перед использованием их надо разобрать,
      // иначе форма поля зависела бы от того, что записали месяц назад.
      const parsed = recommendationEvidenceSchema.safeParse(action.evidence ?? undefined);

      return new TemplateBriefWriter().write({
        actionType: action.actionType,
        title: action.title,
        reason: action.reason,
        sourceDomain: action.sourceDomain,
        evidence: parsed.success ? parsed.data : null,
        affectedClusterCount: action.affectedClusterIds.length,
      });
    }),

  /**
   * Что изменилось после того, как действие закрыли.
   *
   * Только наблюдение: появился ли клиент в ответах, где цитируется этот
   * источник. Причинность отсюда не следует, и оговорка идёт вместе с числом.
   */
  outcome: protectedProcedure
    .input(z.object({ actionId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const action = await getActionById(ctx.db, input.actionId);
      if (!action) {
        assertTenant(null, ctx.user.agencyId);
        throw new Error("unreachable");
      }

      const client = await getClientById(ctx.db, action.clientId);
      assertTenant(client, ctx.user.agencyId);

      // Пока работа не закрыта, «после» не с чем сравнивать.
      if (!action.completedAt || !action.sourceDomain) {
        return null;
      }

      const facts = await listDatedCitationFacts(ctx.db, action.clientId, action.sourceDomain);

      return checkSourceOutcome({
        facts: facts.map((fact) => ({
          responseId: fact.responseId,
          domain: fact.domain,
          observedAt: fact.observedAt,
          clientMentioned: fact.isClient === true,
        })),
        actionDate: action.completedAt,
        sourceDomain: action.sourceDomain,
      });
    }),

  create: roleProcedure("member")
    .input(
      z.object({
        clientId: z.uuid(),
        title: z.string().min(1).max(300),
        // Непустой reason обязателен и здесь, а не только в генераторе:
        // действие без объяснения нельзя защитить перед клиентом (принцип 6).
        reason: z.string().min(1).max(2000),
        actionType: z.enum(ACTION_TYPES),
        estimatedImpact: z.enum(IMPACT).default("medium"),
        effort: z.enum(IMPACT).default("medium"),
        affectedClusterIds: z.array(z.uuid()).max(50).default([]),
        sourceDomain: z.string().max(255).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const client = await getClientById(ctx.db, input.clientId);
      assertTenant(client, ctx.user.agencyId);

      const { clientId, sourceDomain, ...rest } = input;
      const source = sourceDomain ? await getSourceByDomain(ctx.db, sourceDomain) : undefined;

      const action = await createAction(ctx.db, {
        clientId,
        ...rest,
        sourceDomain: sourceDomain ?? null,
        sourceId: source?.id ?? null,
        // Владелец назначается явно, а не автоматически: тот, кто завёл действие,
        // не обязательно тот, кто будет его выполнять.
      });

      await logActivity(ctx.db, {
        agencyId: ctx.user.agencyId,
        clientId,
        actorUserId: null,
        eventType: "action_created",
        payload: { actionId: action.id, title: action.title, actionType: action.actionType },
      });

      return action;
    }),

  /**
   * Превращает рекомендацию в действие одним вызовом.
   * Рекомендация валидируется той же схемой, что и на генерации: клиент мог
   * прислать что угодно, а требование непустого reason — инвариант, а не UI-подсказка.
   */
  convertFromRecommendation: roleProcedure("member")
    .input(z.object({ clientId: z.uuid(), recommendation: recommendationSchema }))
    .mutation(async ({ ctx, input }) => {
      const client = await getClientById(ctx.db, input.clientId);
      assertTenant(client, ctx.user.agencyId);

      return convertRecommendationToAction(ctx.db, {
        clientId: input.clientId,
        agencyId: ctx.user.agencyId,
        recommendation: input.recommendation,
      });
    }),

  update: roleProcedure("member")
    .input(
      z.object({
        id: z.uuid(),
        title: z.string().min(1).max(300).optional(),
        reason: z.string().min(1).max(2000).optional(),
        status: z.enum(STATUS).optional(),
        estimatedImpact: z.enum(IMPACT).optional(),
        effort: z.enum(IMPACT).optional(),
        /** null — снять исполнителя. Работа без владельца стоит молча. */
        ownerUserId: z.uuid().nullable().optional(),
        /**
         * Почему действие отброшено. Обязательно при переводе в dropped:
         * задача, исчезнувшая без объяснения, вернётся той же рекомендацией
         * через месяц, и никто не вспомнит, почему её сняли.
         */
        dropReason: z.string().min(1).max(500).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const action = await getActionById(ctx.db, input.id);
      if (!action) {
        assertTenant(null, ctx.user.agencyId);
        throw new Error("unreachable");
      }
      const client = await getClientById(ctx.db, action.clientId);
      assertTenant(client, ctx.user.agencyId);

      const { id, status, dropReason, ownerUserId, ...patch } = input;

      if (status === "dropped" && !dropReason) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Say why the action is being dropped. It will come back otherwise.",
        });
      }

      // Исполнитель — только из своего агентства. Чужой пользователь
      // неотличим от несуществующего (инвариант 1).
      if (ownerUserId) {
        const members = await listUsersByAgency(ctx.db, ctx.user.agencyId);
        if (!members.some((member) => member.id === ownerUserId)) {
          throw new TRPCError({ code: "NOT_FOUND" });
        }
      }

      // Дата завершения ставится вместе со статусом: без неё эксперимент
      // не сможет отделить «до» от «после».
      const completedAt =
        status === "done" ? (action.completedAt ?? new Date()) : status ? null : undefined;

      const updated = await updateAction(ctx.db, id, {
        ...patch,
        ...(status ? { status } : {}),
        ...(ownerUserId !== undefined ? { ownerUserId } : {}),
        ...(completedAt !== undefined ? { completedAt } : {}),
      });

      if (status && status !== action.status) {
        await logActivity(ctx.db, {
          agencyId: ctx.user.agencyId,
          clientId: action.clientId,
          actorUserId: null,
          // Завершение — отдельное событие: именно оно попадёт в отчёт клиенту
          // и станет точкой отсчёта для эксперимента.
          eventType: status === "done" ? "action_completed" : "action_status_changed",
          payload: {
            actionId: action.id,
            title: action.title,
            from: action.status,
            to: status,
            // Причина отказа хранится там же, где остальная история: в отчёте
            // клиенту её нет, но агентство должно уметь ответить, почему сняли.
            ...(dropReason ? { dropReason } : {}),
          },
        });
      }

      return updated;
    }),

  delete: roleProcedure("member")
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const action = await getActionById(ctx.db, input.id);
      if (!action) {
        assertTenant(null, ctx.user.agencyId);
        throw new Error("unreachable");
      }
      const client = await getClientById(ctx.db, action.clientId);
      assertTenant(client, ctx.user.agencyId);

      await deleteAction(ctx.db, input.id);
      return { id: input.id };
    }),
});
