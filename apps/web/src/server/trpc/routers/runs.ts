import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  billingPeriod,
  canStartMeasurement,
  MIN_SAMPLES_PER_CELL,
  parseAdaptersMode,
  PLATFORM_IDS,
  type PlanId,
} from "@repo/core";
import {
  capacityOptions,
  isCadence,
  refuseSchedule,
  type Cadence,
} from "@repo/core/adapters/capacity";
import { capabilitiesFor, capabilitiesForAgency } from "@repo/core/config/measurement";
import { completeRun } from "@repo/pipeline";
import {
  createRun,
  getClientById,
  getRunById,
  getPromptById,
  getPromptClusterById,
  getScheduleForClient,
  getUsageCounter,
  listActivePromptsForClient,
  listResponsesForPrompt,
  listRecentRuns,
  logActivity,
  upsertRunSchedule,
} from "@repo/db";
import { assertTenant, protectedProcedure, roleProcedure, router } from "../trpc";
import type { TrpcContext } from "../context";
import { entitlementsForAgency } from "../../subscription";

// Литеральный кортеж, а не PLATFORMS: иначе zod выводит string[] и теряет union,
// который ждёт схема БД.
const platformEnum = z.enum(PLATFORM_IDS);

/**
 * Частоты перечисляет конфиг измерения, а не этот файл: список литералов здесь
 * означал бы вторую точку правды, и добавленная в конфиг частота молча не
 * проходила бы валидацию входа.
 */
const cadenceSchema = z.custom<Cadence>(
  (value) => typeof value === "string" && isCadence(value),
  { message: "Unknown cadence." },
);

/**
 * Прогон стоит денег, поэтому его начало проверяется по подписке.
 *
 * Заведение клиента такую проверку уже проходит, а запуск измерения — нет:
 * отменившееся агентство продолжало бы тратить наши деньги на вызовы
 * ассистентов. Просрочка платежа в пределах отсрочки измерение не
 * останавливает — у карты мог кончиться срок, и это не отказ от продукта
 * (`PAST_DUE_GRACE_DAYS`).
 *
 * Публичный отчёт `/r/[token]` этой проверки не получает намеренно: клиент
 * агентства не отвечает за его карту и не должен видеть закрытую дверь.
 */
async function assertMeasurementAllowed(
  db: TrpcContext["db"],
  agencyId: string,
  run?: RunSize,
): Promise<void> {
  const entitlements = await entitlementsForAgency(db, agencyId);

  if (!entitlements.active) {
    // Причина отдаётся как есть: человек должен понять, что делать дальше,
    // а не гадать над кодом ошибки.
    throw new TRPCError({ code: "FORBIDDEN", message: entitlements.reason });
  }

  /**
   * Бесплатный аккаунт ограничен по числу проверок, платящий — нет.
   *
   * До этой проверки месячный лимит нигде не проверялся: он только
   * показывался на экране. Незаплативший мог гонять аудиты бесконечно, и
   * каждый стоил нам живых денег у пяти провайдеров.
   */
  const counter = await getUsageCounter(db, agencyId, billingPeriod());
  const decision = canStartMeasurement(
    entitlements,
    counter?.aiChecksUsed ?? 0,
    run ? plannedChecks(entitlements, run) : 0,
  );

  if (!decision.allowed) {
    throw new TRPCError({ code: "FORBIDDEN", message: decision.message });
  }
}

interface RunSize {
  promptCount: number;
  schedule: { platforms: string[]; samplesPerPrompt: number } | null | undefined;
}

/**
 * Во сколько ответов обойдётся прогон: по нему решается, хватает ли остатка.
 *
 * Без расписания набор берётся у тарифа, а не из общего литерала: умолчание
 * на младшем тарифе уже, чем на старших, и считать всем по широкому значило
 * бы отказывать в прогоне, который на самом деле помещается в остаток.
 */
function plannedChecks(
  entitlements: { plan: PlanId; paying: boolean },
  { promptCount, schedule }: RunSize,
): number {
  const platforms =
    schedule?.platforms.length || capabilitiesForAgency(entitlements).defaultAssistants.length;
  const samples = schedule?.samplesPerPrompt ?? MIN_SAMPLES_PER_CELL;
  return promptCount * platforms * samples;
}

export const runsRouter = router({
  schedule: protectedProcedure
    .input(z.object({ clientId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const client = await getClientById(ctx.db, input.clientId);
      assertTenant(client, ctx.user.agencyId);
      return (await getScheduleForClient(ctx.db, input.clientId)) ?? null;
    }),

  /**
   * Что тариф разрешает измерять и во что обойдётся текущая настройка.
   *
   * Одним запросом, потому что форма расписания должна и предлагать только
   * разрешённое, и показывать цену выбора до сохранения. Возможности берутся
   * из конфига измерения — форма не знает ни одного тарифа по имени.
   */
  capacity: protectedProcedure
    .input(z.object({ clientId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const client = await getClientById(ctx.db, input.clientId);
      assertTenant(client, ctx.user.agencyId);

      const [entitlements, prompts] = await Promise.all([
        entitlementsForAgency(ctx.db, ctx.user.agencyId),
        listActivePromptsForClient(ctx.db, input.clientId),
      ]);

      return {
        ...capacityOptions(entitlements.plan, capabilitiesFor, capabilitiesForAgency(entitlements)),
        /** Активные вопросы клиента — множитель, на который считается оценка. */
        promptCount: prompts.length,
      };
    }),

  saveSchedule: roleProcedure("member")
    .input(
      z.object({
        clientId: z.uuid(),
        cadence: cadenceSchema,
        platforms: z.array(platformEnum).min(1),
        samplesPerPrompt: z.number().int().min(1).max(10),
        active: z.boolean().default(true),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const client = await getClientById(ctx.db, input.clientId);
      assertTenant(client, ctx.user.agencyId);

      /**
       * Тариф проверяется на сервере, а не только формой: форма отражает
       * возможности, но расписание можно сохранить и в обход неё. Сегодня
       * конфиг разрешает всё, и ни один вызов сюда не упирается, — проверка
       * стоит заранее, чтобы ограничение было решением, а не доработкой.
       */
      const entitlements = await entitlementsForAgency(ctx.db, ctx.user.agencyId);
      const prompts = await listActivePromptsForClient(ctx.db, input.clientId);

      const refusal = refuseSchedule(capabilitiesForAgency(entitlements), {
        cadence: input.cadence,
        assistants: input.platforms,
        promptCount: prompts.length,
      });

      if (refusal) {
        throw new TRPCError({ code: "BAD_REQUEST", message: refusal.message });
      }

      const { clientId, ...values } = input;
      return upsertRunSchedule(ctx.db, clientId, values);
    }),

  list: protectedProcedure
    .input(z.object({ clientId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const client = await getClientById(ctx.db, input.clientId);
      assertTenant(client, ctx.user.agencyId);
      return listRecentRuns(ctx.db, input.clientId, 10);
    }),

  get: protectedProcedure.input(z.object({ id: z.uuid() })).query(async ({ ctx, input }) => {
    const run = await getRunById(ctx.db, input.id);
    if (!run) {
      assertTenant(null, ctx.user.agencyId);
      throw new Error("unreachable");
    }
    const client = await getClientById(ctx.db, run.clientId);
    assertTenant(client, ctx.user.agencyId);
    return run;
  }),

  /** История ответов на промпт — то, из чего складывается цифра видимости. */
  responses: protectedProcedure
    .input(z.object({ promptId: z.uuid(), limit: z.number().int().min(1).max(100).default(30) }))
    .query(async ({ ctx, input }) => {
      const prompt = await getPromptById(ctx.db, input.promptId);
      if (!prompt) {
        assertTenant(null, ctx.user.agencyId);
        throw new Error("unreachable");
      }

      const cluster = await getPromptClusterById(ctx.db, prompt.clusterId);
      const client = cluster ? await getClientById(ctx.db, cluster.clientId) : undefined;
      assertTenant(client, ctx.user.agencyId);

      const rows = await listResponsesForPrompt(ctx.db, input.promptId, input.limit);

      return {
        prompt: { id: prompt.id, text: prompt.text, isControl: prompt.isControl },
        // Словарь отдаётся вместе с ответами: подсветка на клиенте должна
        // использовать те же имена, что и парсер.
        dictionary: {
          brandNames: client.brandNames.length > 0 ? client.brandNames : [],
          competitorNames: client.competitorNames,
        },
        responses: rows,
      };
    }),

  triggerManual: roleProcedure("member")
    .input(z.object({ clientId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const client = await getClientById(ctx.db, input.clientId);
      assertTenant(client, ctx.user.agencyId);

      const prompts = await listActivePromptsForClient(ctx.db, input.clientId);
      if (prompts.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Add at least one prompt before running a check.",
        });
      }

      const schedule = await getScheduleForClient(ctx.db, input.clientId);
      // Размер прогона известен до его создания: отказать надо раньше, чем
      // запись появится в базе и повиснет в ожидании навсегда.
      await assertMeasurementAllowed(
        ctx.db,
        ctx.user.agencyId,
        { promptCount: prompts.length, schedule },
      );

      const mode = parseAdaptersMode(process.env.ADAPTERS_MODE);

      const run = await createRun(ctx.db, {
        clientId: input.clientId,
        scheduleId: schedule?.id ?? null,
        trigger: "manual",
        adaptersMode: mode,
      });

      if (mode === "mock") {
        // В mock-режиме прогон занимает миллисекунды, поэтому выполняется здесь же:
        // так ручной запуск работает без поднятого воркера.
        await completeRun(ctx.db, run.id, input.clientId, mode);
      }
      // В live-режиме прогон остаётся pending, и его забирает воркер
      // (`pickUpPendingRuns`): сотни вызовов к платформам не помещаются в
      // один HTTP-запрос, а очередей у веба нет. Экран ждёт статуса прогона.

      return { runId: run.id, executedInline: mode === "mock" };
    }),

  /**
   * Разовый аудит: один прогон по всем платформам и вся цепочка до диагностики
   * без ручных шагов.
   *
   * Расписание аудиту не назначается намеренно — прогон одноразовый, и
   * без `scheduleId` оркестратор берёт полный набор платформ, а не срез,
   * настроенный для платящего клиента.
   */
  startAudit: roleProcedure("member")
    .input(z.object({ clientId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const client = await getClientById(ctx.db, input.clientId);
      assertTenant(client, ctx.user.agencyId);

      const prompts = await listActivePromptsForClient(ctx.db, input.clientId);
      if (prompts.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Generate or import prompts before running an audit.",
        });
      }

      // У аудита расписания нет — он идёт по полному набору ассистентов.
      await assertMeasurementAllowed(
        ctx.db,
        ctx.user.agencyId,
        { promptCount: prompts.length, schedule: null },
      );

      const mode = parseAdaptersMode(process.env.ADAPTERS_MODE);
      const run = await createRun(ctx.db, {
        clientId: input.clientId,
        scheduleId: null,
        trigger: "manual",
        adaptersMode: mode,
      });

      const outcome = mode === "mock"
        ? await completeRun(ctx.db, run.id, input.clientId, mode)
        : null;

      if (outcome) {
        await logActivity(ctx.db, {
          agencyId: ctx.user.agencyId,
          clientId: input.clientId,
          actorUserId: ctx.user.id,
          eventType: "run_finished",
          payload: { runId: run.id, audit: true, responses: outcome.responses },
        });
      }

      return { runId: run.id, executedInline: mode === "mock", outcome };
    }),
});
