import { z } from "zod";
import {
  DEFAULT_GENERATED_PROMPT_COUNT,
  GENERATED_PROMPT_RANGE,
  groupByCluster,
  parsePromptCsv,
  TemplatePromptGenerator,
} from "@repo/core";
import {
  CLUSTER_NAME_MAX,
  PROMPT_TEXT_MAX,
  PROMPTS_PER_CLIENT,
} from "@repo/core/config/measurement";
import {
  createPrompt,
  createPromptCluster,
  deletePrompt,
  deletePromptCluster,
  getClientById,
  getPromptById,
  getPromptClusterById,
  listActivePromptsForClient,
  listPromptClusters,
  listPromptsByClient,
  updatePrompt,
  updatePromptCluster,
} from "@repo/db";
import { TRPCError } from "@trpc/server";
import { assertTenant, protectedProcedure, roleProcedure, router } from "../trpc";

const INTENTS = ["learning", "comparison", "purchase", "other"] as const;

/** Кластер принадлежит клиенту, а клиент — агентству: проверяем всю цепочку. */
async function assertClusterAccess(
  ctx: { db: Parameters<typeof getPromptClusterById>[0]; user: { agencyId: string } },
  clusterId: string,
) {
  const cluster = await getPromptClusterById(ctx.db, clusterId);
  if (!cluster) {
    assertTenant(null, ctx.user.agencyId);
    throw new Error("unreachable");
  }
  const client = await getClientById(ctx.db, cluster.clientId);
  assertTenant(client, ctx.user.agencyId);
  return cluster;
}

/**
 * Хватает ли клиенту места ещё на `adding` активных вопросов.
 *
 * Потолок проверяется на каждом пути, которым вопрос становится активным:
 * форма, черновик, CSV, включение выключенного. Пропусти один — и через
 * него проходят те же тысячи вопросов.
 *
 * ponytail: подсчёт и вставка не под блокировкой — batch из десяти вызовов
 * может перешагнуть потолок на девять. Деньги охраняет лимит проверок при
 * старте прогона, этот потолок — от очереди и базы на десятки тысяч.
 */
async function assertRoomForPrompts(
  db: Parameters<typeof listActivePromptsForClient>[0],
  clientId: string,
  adding: number,
): Promise<void> {
  const active = (await listActivePromptsForClient(db, clientId)).length;
  if (active + adding > PROMPTS_PER_CLIENT) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `A client can have up to ${PROMPTS_PER_CLIENT} active prompts. This one has ${active}; pause or delete some to add ${adding} more.`,
    });
  }
}

const generatedPrompt = z.object({
  text: z.string().min(1).max(PROMPT_TEXT_MAX),
  intent: z.enum(INTENTS),
  cluster: z.string().min(1).max(CLUSTER_NAME_MAX),
  isControl: z.boolean(),
});

/**
 * В mock-режиме промпты собираются из шаблонов. Живой генератор появится
 * вместе с live-адаптерами (T13–T15) — интерфейс для него уже есть в core.
 */
const promptGenerator = new TemplatePromptGenerator();

export const promptsRouter = router({
  clusters: protectedProcedure
    .input(z.object({ clientId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const client = await getClientById(ctx.db, input.clientId);
      assertTenant(client, ctx.user.agencyId);
      return listPromptClusters(ctx.db, input.clientId);
    }),

  list: protectedProcedure
    .input(z.object({ clientId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const client = await getClientById(ctx.db, input.clientId);
      assertTenant(client, ctx.user.agencyId);
      return listPromptsByClient(ctx.db, input.clientId);
    }),

  createCluster: roleProcedure("member")
    .input(
      z.object({
        clientId: z.uuid(),
        name: z.string().min(1).max(CLUSTER_NAME_MAX),
        intent: z.enum(INTENTS).default("other"),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const client = await getClientById(ctx.db, input.clientId);
      assertTenant(client, ctx.user.agencyId);
      return createPromptCluster(ctx.db, input);
    }),

  updateCluster: roleProcedure("member")
    .input(
      z.object({
        id: z.uuid(),
        name: z.string().min(1).max(CLUSTER_NAME_MAX).optional(),
        intent: z.enum(INTENTS).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      await assertClusterAccess(ctx, input.id);
      const { id, ...patch } = input;
      return updatePromptCluster(ctx.db, id, patch);
    }),

  deleteCluster: roleProcedure("member")
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      await assertClusterAccess(ctx, input.id);
      await deletePromptCluster(ctx.db, input.id);
      return { id: input.id };
    }),

  create: roleProcedure("member")
    .input(
      z.object({
        clusterId: z.uuid(),
        text: z.string().min(1).max(PROMPT_TEXT_MAX),
        isControl: z.boolean().default(false),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const cluster = await assertClusterAccess(ctx, input.clusterId);
      await assertRoomForPrompts(ctx.db, cluster.clientId, 1);
      return createPrompt(ctx.db, input);
    }),

  update: roleProcedure("member")
    .input(
      z.object({
        id: z.uuid(),
        text: z.string().min(1).max(PROMPT_TEXT_MAX).optional(),
        isControl: z.boolean().optional(),
        active: z.boolean().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const prompt = await getPromptById(ctx.db, input.id);
      if (!prompt) {
        assertTenant(null, ctx.user.agencyId);
        throw new Error("unreachable");
      }
      const cluster = await assertClusterAccess(ctx, prompt.clusterId);
      if (input.active === true && !prompt.active) {
        await assertRoomForPrompts(ctx.db, cluster.clientId, 1);
      }

      const { id, ...patch } = input;
      return updatePrompt(ctx.db, id, patch);
    }),

  delete: roleProcedure("member")
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const prompt = await getPromptById(ctx.db, input.id);
      if (!prompt) {
        assertTenant(null, ctx.user.agencyId);
        throw new Error("unreachable");
      }
      await assertClusterAccess(ctx, prompt.clusterId);

      await deletePrompt(ctx.db, input.id);
      return { id: input.id };
    }),

  /**
   * Черновик набора промптов. Ничего не сохраняет: список правится человеком,
   * и сохранять предложение модели до правки — значит измерять чужие догадки.
   */
  generate: roleProcedure("member")
    .input(
      z.object({
        clientId: z.uuid(),
        industry: z.string().max(200).optional(),
        count: z
          .number()
          .int()
          .min(GENERATED_PROMPT_RANGE.min)
          .max(GENERATED_PROMPT_RANGE.max)
          .default(DEFAULT_GENERATED_PROMPT_COUNT),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const client = await getClientById(ctx.db, input.clientId);
      assertTenant(client, ctx.user.agencyId);

      const prompts = await promptGenerator.generate(
        {
          domain: client.domain,
          industry: input.industry ?? client.industry ?? "",
          brandNames: client.brandNames.length > 0 ? client.brandNames : [client.name],
          competitorNames: client.competitorNames,
        },
        input.count,
      );

      return { prompts };
    }),

  /** Сохраняет отредактированный черновик: кластеры создаются по именам из него. */
  saveGenerated: roleProcedure("member")
    .input(
      z.object({
        clientId: z.uuid(),
        prompts: z.array(generatedPrompt).min(1).max(GENERATED_PROMPT_RANGE.max),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const client = await getClientById(ctx.db, input.clientId);
      assertTenant(client, ctx.user.agencyId);
      await assertRoomForPrompts(ctx.db, input.clientId, input.prompts.length);

      const existing = await listPromptClusters(ctx.db, input.clientId);
      const byName = new Map(existing.map((cluster) => [cluster.name.toLowerCase(), cluster]));

      let createdClusters = 0;
      let createdPrompts = 0;

      for (const prompt of input.prompts) {
        let cluster = byName.get(prompt.cluster.toLowerCase());
        if (!cluster) {
          cluster = await createPromptCluster(ctx.db, {
            clientId: input.clientId,
            name: prompt.cluster,
            intent: prompt.intent,
          });
          byName.set(prompt.cluster.toLowerCase(), cluster);
          createdClusters++;
        }

        await createPrompt(ctx.db, {
          clusterId: cluster.id,
          text: prompt.text,
          isControl: prompt.isControl,
        });
        createdPrompts++;
      }

      return { createdClusters, createdPrompts };
    }),

  importCsv: roleProcedure("member")
    .input(z.object({ clientId: z.uuid(), csv: z.string().min(1).max(500_000) }))
    .mutation(async ({ ctx, input }) => {
      const client = await getClientById(ctx.db, input.clientId);
      assertTenant(client, ctx.user.agencyId);

      const parsed = parsePromptCsv(input.csv);
      // Файл целиком или ничего: обрезанный импорт молча терял бы вопросы.
      await assertRoomForPrompts(ctx.db, input.clientId, parsed.rows.length);
      const groups = groupByCluster(parsed.rows);

      const existing = await listPromptClusters(ctx.db, input.clientId);
      const byName = new Map(existing.map((cluster) => [cluster.name.toLowerCase(), cluster]));

      let createdClusters = 0;
      let createdPrompts = 0;

      for (const group of groups) {
        // Существующий кластер переиспользуется: повторный импорт того же файла
        // не должен плодить одноимённые кластеры.
        let cluster = byName.get(group.cluster.toLowerCase());
        if (!cluster) {
          cluster = await createPromptCluster(ctx.db, {
            clientId: input.clientId,
            name: group.cluster,
            intent: group.intent,
          });
          byName.set(group.cluster.toLowerCase(), cluster);
          createdClusters++;
        }

        for (const prompt of group.prompts) {
          await createPrompt(ctx.db, {
            clusterId: cluster.id,
            text: prompt.text,
            isControl: prompt.isControl,
          });
          createdPrompts++;
        }
      }

      return {
        createdClusters,
        createdPrompts,
        skipped: parsed.errors.length,
        errors: parsed.errors,
      };
    }),
});
