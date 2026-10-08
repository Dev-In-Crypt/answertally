import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  CATEGORY_INDEX_MIN_WORKSPACES,
  CATEGORY_INDEX_WINDOW_DAYS,
  CLIENT_CATEGORY_IDS,
  canAddClient,
  competitorGapPp,
  compareAssistantSets,
  confidenceFor,
  normalizeDomain,
  PRIORITY_THRESHOLDS,
} from "@repo/core";
import {
  categorySourceIndex,
  countClientsByAgency,
  createClient,
  deleteClient,
  getClientById,
  listClientsByAgency,
  agencyRunStats,
  listPortfolioRows,
  lockAgency,
  updateClient,
} from "@repo/db";
import { assertTenant, protectedProcedure, roleProcedure, router } from "../trpc";
import { capabilitiesForAgency } from "@repo/core/config/measurement";
import { entitlementsForAgency } from "../../subscription";
import { buildWeeklyBrief } from "../../weekly-brief";
import { droppedAssistants, needsFor } from "../../needs";

/**
 * Имена бренда и конкурентов. Границы обязательны: списки лежат в строке
 * клиента, а она читается почти каждым запросом ради проверки владельца, и
 * парсер строит по выражению на каждое имя на каждый ответ. Десять
 * мегабайт имён тормозили бы всё агентство и воркер.
 */
const nameList = z.array(z.string().min(1).max(100)).max(50);

const clientInput = z.object({
  name: z.string().min(1).max(200),
  /**
   * Домен приводится к голому хосту прямо на входе: агентство вставляет его
   * копипастом из адресной строки, а сравнивается он с доменами из цитат.
   * «https://acme.com/» не совпало бы ни с чем, и страницы клиента перестали
   * бы опознаваться как его собственные — диагностика молча соврала бы.
   */
  domain: z
    .string()
    .min(1)
    .max(255)
    .transform(normalizeDomain)
    .refine((value) => value.includes("."), "Enter a domain, for example acme.com"),
  industry: z.string().max(200).optional(),
  /** Категория для общего индекса источников; не выбрана — клиент в индекс не идёт. */
  category: z.enum(CLIENT_CATEGORY_IDS).nullable().optional(),
  brandNames: nameList.default([]),
  competitorNames: nameList.default([]),
  /**
   * `prospect` — клиент для бесплатного аудита: ещё не платит, но измеряется
   * тем же пайплайном. Отдельного флага нет — статус и так перечисление.
   */
  status: z.enum(["active", "paused", "prospect"]).optional(),
});

/**
 * Входные данные обновления: те же поля, но без умолчаний. Отсутствующий ключ
 * обязан означать «не трогай», а не «поставь пустое». Отрасль стирается явным
 * `null`: иначе очищенное поле молча оставляло старую, и она продолжала
 * подставляться в генерацию промптов.
 */
const clientPatch = clientInput.omit({ brandNames: true, competitorNames: true }).partial().extend({
  industry: z.string().max(200).nullable().optional(),
  brandNames: nameList.optional(),
  competitorNames: nameList.optional(),
});

export const clientsRouter = router({
  list: protectedProcedure.query(({ ctx }) => listClientsByAgency(ctx.db, ctx.user.agencyId)),

  /**
   * Портфель агентства — первый экран продукта.
   *
   * Отдаёт не только цифры, но и то, что требует человека: отчёт на
   * согласовании, зависшие действия, сломанное расписание. Экран, который
   * показывает только проценты, не отвечает на вопрос «чем мне заняться».
   */
  portfolio: protectedProcedure.query(async ({ ctx }) => {
    /**
     * Права считаются здесь, а не в `needsFor`: расписание переживает и смену
     * тарифа, и решение перестать измерять платформу, и понять, что из
     * настроенного уже не спрашивается, можно только зная тариф.
     */
    const [rows, entitlements] = await Promise.all([
      listPortfolioRows(ctx.db, ctx.user.agencyId, new Date(), PRIORITY_THRESHOLDS.high),
      entitlementsForAgency(ctx.db, ctx.user.agencyId),
    ]);
    const allowedAssistants = capabilitiesForAgency(entitlements).assistants;

    const mapped = rows.map((row) => {
      const gapPp =
        row.visibilityPct === null
          ? null
          : competitorGapPp({
              clusterId: null,
              platform: null,
              periodStart: new Date(0),
              periodEnd: new Date(0),
              clientVisibilityPct: row.visibilityPct,
              competitorVisibility: row.competitorVisibility,
              sampleCount: row.sampleCount,
              sufficient: row.sufficient,
            });

      const needs = needsFor(row, allowedAssistants);

      /**
       * В портфеле изменение показывается только при одинаковом составе.
       *
       * Это колонка для беглого просмотра всего списка: по ней решают, к
       * кому идти. Сигнал, который на деле может быть следствием включённой
       * галочки, а не работы, здесь хуже отсутствующего. Число, пересчитанное
       * по общей части наборов, лежит на один клик дальше — на экране
       * клиента, где рядом с ним стоит объяснение.
       */
      const deltaBasis = compareAssistantSets(row.latestAssistants, row.previousAssistants);

      return {
        clientId: row.clientId,
        name: row.name,
        domain: row.domain,
        status: row.status,
        visibilityPct: row.visibilityPct,
        gapPp,
        deltaPp: deltaBasis.verdict === "same" ? row.deltaPp : null,
        deltaBasis: deltaBasis.verdict,
        /**
         * Сколько настроенных ассистентов больше не спрашивается. Числом, а
         * не разбором строки из `needs`: справочник клиентов показывает ту же
         * беду короче, и две формулировки одного факта однажды разойдутся.
         */
        droppedAssistants: droppedAssistants(row, allowedAssistants).length,
        sampleCount: row.sampleCount,
        sufficient: row.sufficient,
        confidence: confidenceFor(row.sampleCount),
        openActions: row.openActions,
        lastRunAt: row.lastRunAt,
        openOpportunities: row.openOpportunities,
        highPriorityOpportunities: row.highPriorityOpportunities,
        newOpportunities: row.newOpportunities,
        topOpportunityScore: row.topOpportunityScore,
        reportsAwaitingApproval: row.reportsAwaitingApproval,
        staleActions: row.staleActions,
        needs: needs.map((item) => item.text),
        needsRows: needs,
      };
    });

    /**
     * Порядок отвечает на вопрос «кем заняться сегодня», а не «у кого выше
     * процент». Сначала те, где что-то ждёт человека, среди них — по самой
     * весомой возможности; остальные следом в исходном порядке.
     */
    return [...mapped].sort((a, b) => {
      const waiting = Number(b.needs.length > 0) - Number(a.needs.length > 0);
      if (waiting !== 0) return waiting;
      return (b.topOpportunityScore ?? -1) - (a.topOpportunityScore ?? -1);
    });
  }),

  /**
   * Недельная сводка агентства.
   *
   * Считается из тех же портфельных строк — второй запрос по тем же данным
   * стоил бы того же времени и однажды разошёлся бы с экраном. Вынесена
   * отдельной процедурой, потому что тот же результат должен уметь уйти
   * письмом: отправитель в продукте уже есть, и новых интеграций для этого
   * заводить не нужно.
   */
  weeklyBrief: protectedProcedure.query(async ({ ctx }) => {
    /**
     * Права считаются здесь, а не в `needsFor`: расписание переживает и смену
     * тарифа, и решение перестать измерять платформу, и понять, что из
     * настроенного уже не спрашивается, можно только зная тариф.
     */
    const [rows, entitlements] = await Promise.all([
      listPortfolioRows(ctx.db, ctx.user.agencyId, new Date(), PRIORITY_THRESHOLDS.high),
      entitlementsForAgency(ctx.db, ctx.user.agencyId),
    ]);
    const allowedAssistants = capabilitiesForAgency(entitlements).assistants;

    return buildWeeklyBrief(
      rows.map((row) => ({
        clientId: row.clientId,
        name: row.name,
        needs: needsFor(row, allowedAssistants),
        newOpportunities: row.newOpportunities,
        highPriorityOpportunities: row.highPriorityOpportunities,
        reportsAwaitingApproval: row.reportsAwaitingApproval,
        staleActions: row.staleActions,
        topOpportunityScore: row.topOpportunityScore,
      })),
    );
  }),

  /** Состояние прогонов агентства: что запустится сегодня и что уже упало. */
  runStats: protectedProcedure.query(({ ctx }) => agencyRunStats(ctx.db, ctx.user.agencyId)),

  get: protectedProcedure.input(z.object({ id: z.uuid() })).query(async ({ ctx, input }) => {
    const client = await getClientById(ctx.db, input.id);
    assertTenant(client, ctx.user.agencyId);
    return client;
  }),

  /**
   * Где ассистенты берут ответы в категории клиента — по всем агентствам.
   * Наружу — только домены и счёт, и только от трёх агентств (условия, раздел 5).
   */
  categoryIndex: protectedProcedure.input(z.object({ id: z.uuid() })).query(async ({ ctx, input }) => {
    const client = await getClientById(ctx.db, input.id);
    assertTenant(client, ctx.user.agencyId);
    if (!client.category) return { category: null, workspaces: 0, answers: 0, top: [] };
    const since = new Date(Date.now() - CATEGORY_INDEX_WINDOW_DAYS * 86_400_000);
    const index = await categorySourceIndex(ctx.db, client.category, since, CATEGORY_INDEX_MIN_WORKSPACES);
    return { category: client.category, ...index };
  }),

  create: roleProcedure("admin")
    .input(clientInput)
    .mutation(async ({ ctx, input }) =>
      // Подсчёт и вставка под блокировкой агентства: иначе batch из десяти
      // вызовов видел «0 клиентов» десять раз и обходил лимит тарифа.
      ctx.db.transaction(async (tx) => {
        await lockAgency(tx, ctx.user.agencyId);
        const [entitlements, used] = await Promise.all([
          entitlementsForAgency(tx, ctx.user.agencyId),
          countClientsByAgency(tx, ctx.user.agencyId),
        ]);

        /**
         * Лимит тарифа — billing unit продукта это активный клиентский аккаунт.
         * Считается от подписки, а не от полей агентства: они производные, и
         * рассинхрон должен разрешаться в пользу того, за что заплачено.
         */
        const decision = canAddClient(entitlements, used);
        if (!decision.allowed) {
          throw new TRPCError({ code: "FORBIDDEN", message: decision.message });
        }

        return createClient(tx, { ...input, agencyId: ctx.user.agencyId });
      }),
    ),

  /**
   * Частичное обновление. `clientPatch`, а не `clientInput.partial()`:
   * у списков в `clientInput` стоит `.default([])`, и zod подставляет его даже
   * тогда, когда ключа во входе не было. Обновление одного статуса стирало бы
   * бренды и конкурентов — молча и необратимо, а по списку конкурентов
   * считается всё, что продукт вообще измеряет.
   */
  update: roleProcedure("admin")
    .input(clientPatch.extend({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await getClientById(ctx.db, input.id);
      assertTenant(existing, ctx.user.agencyId);

      const { id, ...patch } = input;
      return updateClient(ctx.db, id, patch);
    }),

  delete: roleProcedure("admin")
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const existing = await getClientById(ctx.db, input.id);
      assertTenant(existing, ctx.user.agencyId);

      await deleteClient(ctx.db, input.id);
      return { id: input.id };
    }),
});
