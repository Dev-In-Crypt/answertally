import { randomBytes } from "node:crypto";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { assertMaySendReport, refundDailyQuota } from "../../email-quota";
import {
  buildAuditProposal,
  buildRecommendations,
  buildReportPayload,
  collapsePromptFacts,
  compareAssistantSets,
  computeMovement,
  computePromptMatrix,
  diagnose,
  measuredAssistants,
  restrictToAssistants,
  PROPOSAL_CAVEATS,
  PROPOSAL_DEFAULTS,
  REPORT_COPY,
  reportReadyEmail,
  summariseTraffic,
} from "@repo/core";
import type { CitationFact, SourceType, VisibilitySnapshot } from "@repo/core";
import {
  listAgencyReportsWithApproval,
  listCitationFacts,
  countClientAnswersBetween,
  countNewCitedDomains,
  createReport,
  createReportShare,
  getAgencyById,
  getClientById,
  getReportById,
  getShareForReport,
  revokeReportShares,
  listActions,
  listActionsCompletedBetween,
  listOpportunities,
  listActivePromptsForClient,
  listAllSnapshots,
  listAssistantTraffic,
  listPromptPlatformFacts,
  listReports,
  listExperiments,
  logActivity,
  setReportStatus,
} from "@repo/db";
import { assertTenant, protectedProcedure, roleProcedure, router } from "../trpc";
import { experimentOutcomes } from "../../experiment-results";
import { getEmailSender } from "../../email";
import { reportUrl } from "@/app/r/report-url";

/** Та же схлопка, что в роутере диагностики: один факт на пару (ответ, домен). */
function toFacts(
  rows: {
    responseId: string;
    domain: string;
    sourceType: string | null;
    entityName: string | null;
    isClient: boolean | null;
    isCompetitor: boolean | null;
  }[],
): CitationFact[] {
  const byKey = new Map<string, CitationFact>();

  for (const row of rows) {
    const key = `${row.responseId}|${row.domain}`;
    let entry = byKey.get(key);
    if (!entry) {
      entry = {
        domain: row.domain,
        sourceType: (row.sourceType as SourceType | null) ?? null,
        clientMentioned: false,
        competitorsMentioned: [],
      };
      byKey.set(key, entry);
    }
    if (row.isClient) entry.clientMentioned = true;
    if (row.isCompetitor && row.entityName) entry.competitorsMentioned.push(row.entityName);
  }

  return [...byKey.values()];
}

const NO_MEASUREMENT_YET =
  "There's no measured week in this period yet. Run a measurement, then generate the report once it finishes.";

/** Период по умолчанию — календарный месяц назад от конца. */
function defaultPeriod(): { start: Date; end: Date } {
  const end = new Date();
  const start = new Date(end.getTime() - 30 * 24 * 60 * 60 * 1000);
  return { start, end };
}

export const reportsRouter = router({
  /**
   * Все отчёты агентства одним списком.
   *
   * Экран клиента отвечает на вопрос «что мы отдали этому клиенту», но
   * «пять отчётов ждут согласования» на главной — вопрос про всё агентство,
   * и обходить ради него клиентов по одному значит платить запросом за
   * каждого.
   */
  listForAgency: protectedProcedure.query(({ ctx }) =>
    listAgencyReportsWithApproval(ctx.db, ctx.user.agencyId),
  ),

  list: protectedProcedure.input(z.object({ clientId: z.uuid() })).query(async ({ ctx, input }) => {
    const client = await getClientById(ctx.db, input.clientId);
    assertTenant(client, ctx.user.agencyId);

    return listReports(ctx.db, input.clientId);
  }),

  get: protectedProcedure.input(z.object({ id: z.uuid() })).query(async ({ ctx, input }) => {
    const report = await getReportById(ctx.db, input.id);
    if (!report) {
      assertTenant(null, ctx.user.agencyId);
      throw new Error("unreachable");
    }
    const client = await getClientById(ctx.db, report.clientId);
    assertTenant(client, ctx.user.agencyId);

    return { report, share: await getShareForReport(ctx.db, report.id) };
  }),

  /**
   * Собирает отчёт за период и сохраняет payload целиком.
   * Payload не пересчитывается при просмотре: клиент видел конкретные цифры
   * на конкретную дату, и менять их задним числом нельзя.
   */
  generate: roleProcedure("member")
    .input(
      z.object({
        clientId: z.uuid(),
        periodStart: z.iso.datetime().optional(),
        periodEnd: z.iso.datetime().optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const client = await getClientById(ctx.db, input.clientId);
      assertTenant(client, ctx.user.agencyId);

      const fallback = defaultPeriod();
      const periodStart = input.periodStart ? new Date(input.periodStart) : fallback.start;
      const periodEnd = input.periodEnd ? new Date(input.periodEnd) : fallback.end;

      const [
        snapshotRows,
        completedActions,
        newCitedUrls,
        clientAnswers,
        experiments,
        allActions,
        allOpportunities,
      ] = await Promise.all([
        listAllSnapshots(ctx.db, input.clientId),
        listActionsCompletedBetween(ctx.db, input.clientId, periodStart, periodEnd),
        countNewCitedDomains(ctx.db, input.clientId, periodStart, periodEnd),
        countClientAnswersBetween(ctx.db, input.clientId, periodStart, periodEnd),
        listExperiments(ctx.db, input.clientId),
        listActions(ctx.db, input.clientId),
        listOpportunities(ctx.db, input.clientId),
      ]);

      // Уже отсортированы движком по оценке; в отчёт едут заголовок, причина
      // и объём — без самой оценки.
      const openOpportunities = allOpportunities.filter((row) => row.status === "open");

      // Только свёртки (все кластеры, все платформы) и только внутри периода:
      // клиенту показывается общая видимость, а не срез по одной платформе.
      const snapshots: VisibilitySnapshot[] = snapshotRows
        .filter(
          (row) =>
            row.clusterId === null &&
            row.platform === null &&
            row.periodStart >= periodStart &&
            row.periodStart <= periodEnd,
        )
        .map((row) => ({
          clusterId: null,
          platform: null,
          periodStart: row.periodStart,
          periodEnd: row.periodEnd,
          clientVisibilityPct: Number(row.clientVisibilityPct),
          competitorVisibility: row.competitorVisibility,
          sampleCount: row.sampleCount,
          sufficient: row.sufficient,
        }));

      // Без единой измеренной недели отчёт сказал бы клиенту «0%, up from 0%» —
      // это читается как результат, а не как «ещё не мерили».
      if (snapshots.length === 0) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: NO_MEASUREMENT_YET });
      }

      /**
       * Результаты экспериментов считает та же функция, что и экран: отчёт
       * клиенту и экран агентства не имеют права расходиться в цифрах.
       */
      const outcomes = (await experimentOutcomes(ctx.db, input.clientId, experiments)).filter(
        (outcome) => outcome.readable,
      );

      const actionTitles = new Map(allActions.map((action) => [action.id, action.title]));

      const learned = outcomes.slice(0, 5).map((outcome) => ({
        title: actionTitles.get(outcome.experiment.actionId) ?? "Completed work",
        observed: outcome.formatted,
        confidence: outcome.estimate.confidence,
      }));

      // «Самое влиятельное» — с наибольшим наблюдавшимся движением, а не с
      // самой крупной задачей: размер работы ничего не измеряет. Только из
      // экспериментов с нетронутыми темами: без них «вклад» — это сырое
      // движение тронутых тем, и метод прямо обещает его вкладом не называть.
      const leading = outcomes
        .filter((outcome) => outcome.experiment.controlClusterIds.length > 0)
        .sort(
        (a, b) => (b.estimate.incrementalPp ?? 0) - (a.estimate.incrementalPp ?? 0),
      )[0];
      const leadingTitle = leading ? actionTitles.get(leading.experiment.actionId) : undefined;

      const caveats: string[] = [];
      if (experiments.some((experiment) => experiment.controlClusterIds.length === 0)) {
        caveats.push(REPORT_COPY.noComparisonGroup);
      }
      const periodDays = (periodEnd.getTime() - periodStart.getTime()) / (24 * 60 * 60 * 1000);
      if (periodDays < 60) {
        // Спек: моделям нужно 60–90 дней, чтобы переобойти и сдвинуть цитаты.
        caveats.push(REPORT_COPY.shortPeriod);
      }

      // Платформы берутся из срезов по платформам, а не из расписания:
      // важно, что реально измерено, а не что было настроено.
      const measuredPlatforms = [
        ...new Set(
          snapshotRows
            .filter((row) => row.platform !== null && row.periodStart >= periodStart)
            .map((row) => row.platform as string),
        ),
      ];

      /**
       * Составы ассистентов на обоих концах периода — по срезам, а не по
       * расписанию: важно, кто ответил, а не кого просили спросить.
       *
       * Берутся крайние недели периода. Именно они стоят в отчёте как
       * «было» и «стало», и именно их знаменатели обязаны совпадать.
       */
      const platformRows = snapshotRows.filter(
        (row) =>
          row.clusterId === null &&
          row.platform !== null &&
          row.periodStart >= periodStart &&
          row.periodStart <= periodEnd,
      );
      const weeks = [...new Set(platformRows.map((row) => row.periodStart.getTime()))].sort(
        (a, b) => a - b,
      );
      const cellsOfWeek = (at: number | undefined) =>
        platformRows
          .filter((row) => row.periodStart.getTime() === at)
          .map((row) => ({
            assistantId: row.platform as string,
            sampleCount: row.sampleCount,
            clientVisibilityPct: Number(row.clientVisibilityPct),
          }));

      const firstCells = cellsOfWeek(weeks.at(0));
      const lastCells = cellsOfWeek(weeks.at(-1));

      /**
       * Передаём только тогда, когда состав известен на обоих концах.
       *
       * Отсутствие срезов по платформам — это не «набор менялся», а «мы не
       * знаем». Стереть на этом основании разницу, которую агентство уже
       * показывало клиенту, значило бы сломать отчёт там, где никаких
       * оснований для тревоги нет.
       */
      const assistantCells =
        firstCells.length > 0 && lastCells.length > 0
          ? { first: firstCells, last: lastCells }
          : undefined;

      /**
       * Движение по отдельным вопросам за период против такого же окна перед
       * ним. Считается по тем же ответам, что и экран клиента, и попадает
       * в отчёт только там, где обе выборки набрали порог: вопрос, который
       * нечем сравнить, не должен выглядеть как «не изменился».
       */
      const periodMs = periodEnd.getTime() - periodStart.getTime();
      const previousStart = new Date(periodStart.getTime() - periodMs);

      const [currentFacts, previousFacts, activePrompts] = await Promise.all([
        listPromptPlatformFacts(ctx.db, input.clientId, periodStart, periodEnd),
        listPromptPlatformFacts(ctx.db, input.clientId, previousStart, periodStart),
        listActivePromptsForClient(ctx.db, input.clientId),
      ]);

      const promptRows = activePrompts.map((prompt) => ({
        id: prompt.id,
        text: prompt.text,
        clusterId: prompt.clusterId,
      }));

      const currentInput = {
        records: collapsePromptFacts(currentFacts),
        prompts: promptRows,
        from: periodStart,
        to: periodEnd,
      };
      const previousInput = {
        records: collapsePromptFacts(previousFacts),
        prompts: promptRows,
        from: previousStart,
        to: periodStart,
      };

      const currentMatrix = computePromptMatrix(currentInput);
      const previousMatrix = computePromptMatrix(previousInput);

      /**
       * Движение считается по ассистентам, которых мерили в обоих окнах.
       *
       * Иначе включённый или выключенный ассистент попадает в отчёт клиенту
       * как результат работы агентства: знаменатель доли другой, число
       * поехало, и выборка этот сдвиг подтвердит — интервалы не пересекутся.
       */
      const movementBasis = compareAssistantSets(
        measuredAssistants(currentMatrix),
        measuredAssistants(previousMatrix),
      );
      const comparable =
        movementBasis.delta === "show"
          ? { current: currentMatrix, previous: previousMatrix }
          : {
              current: restrictToAssistants(currentInput, movementBasis.shared),
              previous: restrictToAssistants(previousInput, movementBasis.shared),
            };

      const movementEntries = computeMovement(comparable.current, comparable.previous);
      const deltas = new Map(movementEntries.map((entry) => [entry.promptId, entry.deltaPp]));

      const distinguishable = new Set(
        movementEntries.filter((entry) => entry.distinguishable).map((entry) => entry.promptId),
      );

      const movement = comparable.current.rows
        // В отчёт клиенту идёт только то, что выборка действительно различает:
        // «+3 pp», неотличимые от шума, читаются как результат работы.
        .filter(
          (row) =>
            deltas.get(row.promptId) != null &&
            row.ratePct !== null &&
            distinguishable.has(row.promptId),
        )
        .map((row) => ({
          prompt: row.promptText,
          deltaPp: deltas.get(row.promptId)!,
          sharePct: row.ratePct!,
        }))
        // Сначала то, что сдвинулось сильнее — об этом и спросят.
        .sort((a, b) => Math.abs(b.deltaPp) - Math.abs(a.deltaPp))
        .slice(0, 20);

      /**
       * Переходы от ассистентов за тот же период. В отчёт попадают только
       * если аналитику импортировали: пустая таблица читалась бы клиентом
       * как «переходов не было», а верное утверждение — «мы их не считали».
       */
      const trafficRows = await listAssistantTraffic(ctx.db, input.clientId);
      const traffic = summariseTraffic(
        trafficRows.map((row) => ({
          day: new Date(`${row.day}T00:00:00.000Z`),
          assistant: row.assistant,
          sessions: row.sessions,
        })),
        periodStart,
        periodEnd,
      );

      const payload = buildReportPayload({
        movement,
        ...(traffic.totalSessions > 0
          ? {
              assistantTraffic: {
                totalSessions: traffic.totalSessions,
                byAssistant: traffic.byAssistant
                  .slice(0, 10)
                  .map(({ assistant, sessions }) => ({ assistant, sessions })),
              },
            }
          : {}),
        clientName: client.name,
        periodStart,
        periodEnd,
        snapshots,
        measuredPlatforms,
        ...(assistantCells ? { assistantCells } : {}),
        completedActions: completedActions.map((action) => ({
          title: action.title,
          actionType: action.actionType,
        })),
        newCitedUrls,
        newBrandMentions: clientAnswers.naming,
        sampledAnswers: clientAnswers.sampled,
        /**
         * Самое влиятельное действие — из экспериментов, у которых после
         * работы набралось достаточно ответов. Раздел был пуст всегда, пока
         * эксперименты не научились доходить до готовности; выдумывать в него
         * «главное действие» по размеру задачи было бы обратным продукту.
         */
        highestImpact: leading
          ? {
              title: leadingTitle ?? "Completed work",
              // Диапазон вместо точки строит сам сборщик отчёта: точность,
              // которой нет, не должна выглядеть как точность.
              incrementalPp: leading.estimate.incrementalPp,
              confidence: leading.estimate.confidence,
            }
          : null,
        /**
         * Чему научились: что запускали и что за этим наблюдалось. Только
         * читаемые эксперименты — «данных не хватило» это не урок, а пробел.
         */
        whatWeLearned: learned,
        nextSprint: allActions
          .filter((action) => action.status === "backlog" || action.status === "in_progress")
          .slice(0, 3)
          .map((action) => action.title),
        /**
         * Что стоит сделать дальше — из найденных возможностей, уже
         * отсортированных движком. Внутренняя оценка в отчёт не переносится:
         * клиенту она читалась бы как балл его сайта.
         */
        topOpportunities: openOpportunities.slice(0, 5).map((opportunity) => ({
          title: opportunity.title,
          reason: opportunity.reason,
          affectedPrompts: opportunity.affectedPromptIds.length,
          evidence: opportunity.evidenceLevel,
        })),
        caveats,
      });

      const report = await createReport(ctx.db, {
        clientId: input.clientId,
        periodStart,
        periodEnd,
        status: "draft",
        payload,
      });

      await logActivity(ctx.db, {
        agencyId: ctx.user.agencyId,
        clientId: input.clientId,
        actorUserId: null,
        eventType: "report_generated",
        payload: { reportId: report.id, period: payload.period },
      });

      return report;
    }),

  /**
   * Отчёт по бесплатному аудиту: что показали измерения, что предлагается
   * сделать и во что это обойдётся.
   *
   * Ретейнер и часы приходят из формы, а не считаются: их знает только
   * агентство. Дефолты из спека подставляются, если поле не заполнено.
   */
  generateOpportunity: roleProcedure("member")
    .input(
      z.object({
        clientId: z.uuid(),
        retainerUsd: z.number().int().positive().max(1_000_000).optional(),
        effortHoursMin: z.number().positive().max(1000).optional(),
        effortHoursMax: z.number().positive().max(1000).optional(),
        hourlyCostUsd: z.number().positive().max(10_000).optional(),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const client = await getClientById(ctx.db, input.clientId);
      assertTenant(client, ctx.user.agencyId);

      const [snapshotRows, citationRows] = await Promise.all([
        listAllSnapshots(ctx.db, input.clientId),
        listCitationFacts(ctx.db, input.clientId, null),
      ]);

      // Аудит — снимок «как сейчас», поэтому берётся последняя свёртка,
      // а не движение за период: движения ещё не было.
      const rollups = snapshotRows.filter((row) => row.clusterId === null && row.platform === null);
      const latest = rollups.at(-1);
      // Аудит без замера показал бы проспекту «0% сегодня» как факт.
      if (!latest) {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: NO_MEASUREMENT_YET });
      }

      const snapshots: VisibilitySnapshot[] = [
        {
          clusterId: null,
          platform: null,
          periodStart: latest.periodStart,
          periodEnd: latest.periodEnd,
          clientVisibilityPct: Number(latest.clientVisibilityPct),
          competitorVisibility: latest.competitorVisibility,
          sampleCount: latest.sampleCount,
          sufficient: latest.sufficient,
        },
      ];

      const recommendations = buildRecommendations(diagnose(toFacts(citationRows)));

      const effortHours = {
        min: input.effortHoursMin ?? PROPOSAL_DEFAULTS.effortHours.min,
        max: input.effortHoursMax ?? PROPOSAL_DEFAULTS.effortHours.max,
      };

      const opportunity = buildAuditProposal({
        currentVisibilityPct: Number(latest.clientVisibilityPct),
        competitorVisibility: latest.competitorVisibility,
        rankedActions: recommendations.map((recommendation) => ({
          title: recommendation.title,
          reason: recommendation.reason,
          estimatedImpact: recommendation.estimatedImpact,
          effort: recommendation.effort,
        })),
        ...(input.retainerUsd !== undefined ? { retainerUsd: input.retainerUsd } : {}),
        effortHours,
        ...(input.hourlyCostUsd !== undefined ? { hourlyCostUsd: input.hourlyCostUsd } : {}),
      });

      const caveats: string[] = [...PROPOSAL_CAVEATS];
      // Недобор сэмплов в аудите — обычное дело: прогон один.
      if (!latest.sufficient) {
        caveats.push(REPORT_COPY.shortPeriod);
      }

      const periodEnd = latest.periodEnd;
      const periodStart = latest.periodStart;
      const auditAnswers = await countClientAnswersBetween(ctx.db, input.clientId, periodStart, periodEnd);

      // Доля по ассистентам той же недели — для диаграммы в отчёте. Один
      // прогон, поэтому «первая» и «последняя» неделя совпадают.
      const auditCells = snapshotRows
        .filter(
          (row) =>
            row.clusterId === null &&
            row.platform !== null &&
            row.periodStart.getTime() === latest.periodStart.getTime(),
        )
        .map((row) => ({
          assistantId: row.platform as string,
          sampleCount: row.sampleCount,
          clientVisibilityPct: Number(row.clientVisibilityPct),
        }));

      const payload = buildReportPayload({
        clientName: client.name,
        periodStart,
        periodEnd,
        snapshots,
        measuredPlatforms: [
          ...new Set(
            snapshotRows
              .filter((row) => row.platform !== null)
              .map((row) => row.platform as string),
          ),
        ],
        completedActions: [],
        newCitedUrls: 0,
        // Раньше здесь стоял 0 при ненулевой доле: аудит не считал ответы вовсе.
        newBrandMentions: auditAnswers.naming,
        sampledAnswers: auditAnswers.sampled,
        highestImpact: null,
        // Ближайшие шаги — верх того же ранжированного списка, без выдумок.
        nextSprint: opportunity.rankedActions.slice(0, 3).map((action) => action.title),
        caveats,
        opportunity,
        ...(auditCells.length > 0 ? { assistantCells: { first: auditCells, last: auditCells } } : {}),
      });

      const report = await createReport(ctx.db, {
        clientId: input.clientId,
        periodStart,
        periodEnd,
        status: "draft",
        payload,
      });

      await logActivity(ctx.db, {
        agencyId: ctx.user.agencyId,
        clientId: input.clientId,
        actorUserId: null,
        eventType: "report_generated",
        payload: { reportId: report.id, audit: true },
      });

      return report;
    }),

  /**
   * Отозвать ссылку на отчёт: она перестаёт открываться, а следующая
   * выдача даст новую. Так обещано в политике конфиденциальности и DPA.
   */
  revokeShare: roleProcedure("member")
    .input(z.object({ reportId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const report = await getReportById(ctx.db, input.reportId);
      if (!report) {
        assertTenant(null, ctx.user.agencyId);
        throw new Error("unreachable");
      }
      const client = await getClientById(ctx.db, report.clientId);
      assertTenant(client, ctx.user.agencyId);

      await revokeReportShares(ctx.db, report.id);
      // «Отправлен» без живой ссылки — неправда: клиенту больше нечего открыть.
      // Подтверждённый отчёт подтверждённым и остаётся.
      if (report.status === "shared") await setReportStatus(ctx.db, report.id, "draft");
      return { reportId: report.id };
    }),

  /** Выдаёт ссылку для клиента агентства. Повторный вызов её не меняет. */
  share: roleProcedure("member")
    .input(z.object({ reportId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const report = await getReportById(ctx.db, input.reportId);
      if (!report) {
        assertTenant(null, ctx.user.agencyId);
        throw new Error("unreachable");
      }
      const client = await getClientById(ctx.db, report.clientId);
      assertTenant(client, ctx.user.agencyId);

      // Подтверждённый отчёт ссылкой обратно в «отправлен» не уходит. Статус
      // ставится и для уже живой ссылки: старые печати PDF выдавали её молча.
      if (report.status === "draft") await setReportStatus(ctx.db, report.id, "shared");

      const existing = await getShareForReport(ctx.db, report.id);
      if (existing) {
        return { token: existing.token, created: false };
      }

      // 32 байта: ссылка — единственный способ доступа, и перебор должен быть
      // бессмысленным.
      const token = randomBytes(32).toString("base64url");
      await createReportShare(ctx.db, { reportId: report.id, token });

      return { token, created: true };
    }),

  /**
   * Отправляет клиенту ссылку на отчёт.
   *
   * Явное действие человека, а не рассылка: продукт ничего не отправляет сам
   * (инвариант 4). Письмо несёт ссылку, а не сам отчёт — документ живёт на
   * своей странице, где его можно согласовать, и не расходится копиями по
   * почтовым ящикам.
   */
  send: roleProcedure("member")
    .input(z.object({ reportId: z.uuid(), to: z.email(), note: z.string().max(500).optional() }))
    .mutation(async ({ ctx, input }) => {
      const report = await getReportById(ctx.db, input.reportId);
      if (!report) {
        assertTenant(null, ctx.user.agencyId);
        throw new Error("unreachable");
      }
      const client = await getClientById(ctx.db, report.clientId);
      assertTenant(client, ctx.user.agencyId);
      const spend = await assertMaySendReport(ctx.db, ctx.user.agencyId);

      const agency = await getAgencyById(ctx.db, ctx.user.agencyId);

      // Ссылка выдаётся здесь же, если её ещё не было: отправлять отчёт,
      // который некуда открыть, бессмысленно.
      let share = await getShareForReport(ctx.db, report.id);
      if (!share) {
        const token = randomBytes(32).toString("base64url");
        share = await createReportShare(ctx.db, { reportId: report.id, token });
      }
      // Подтверждённый отчёт ссылкой обратно в «отправлен» не уходит.
      if (report.status === "draft") await setReportStatus(ctx.db, report.id, "shared");

      const message = reportReadyEmail({
        to: input.to,
        // Письмо клиенту агентства несёт бренд агентства, а не продукта
        // (инвариант 3): подписывается оно именем агентства.
        agencyName: agency?.name ?? "Your agency",
        clientName: client.name,
        periodStart: report.periodStart.toISOString().slice(0, 10),
        periodEnd: report.periodEnd.toISOString().slice(0, 10),
        // Ссылка — на домене агентства, если он настроен. Это единственное
        // место, где адрес видит клиент агентства: отправить сюда наш домен
        // значило бы поставить свою подпись под чужим отчётом.
        reportUrl: reportUrl(share.token),
        // Отвечают на такое письмо тому, кто его прислал, а не техническому
        // адресу отправки: в поле «Кому» встанет человек из агентства.
        agencyReplyTo: ctx.user.email,
        ...(input.note ? { note: input.note } : {}),
      });

      /**
       * Отказ почты не отменяет уже выданную ссылку — как и у приглашения.
       * Ссылка возвращается в любом случае, и агентство отдаёт её само;
       * иначе сбой транспорта съедал бы готовый отчёт.
       */
      let delivered = false;
      try {
        // Режим без транспорта письмо только записывает: «отправлено» было бы
        // неправдой, и агентство ждало бы ответа на письмо, которого нет.
        delivered = !(await getEmailSender().send(message)).logged;
      } catch (error) {
        console.error(`[report] delivery failed for report ${report.id}`, error);
      }
      // Неушедшее письмо квоту не тратит.
      if (!delivered) await refundDailyQuota(spend);

      await logActivity(ctx.db, {
        agencyId: ctx.user.agencyId,
        clientId: client.id,
        // Как и остальные события журнала — без ссылки на пользователя:
        // строка живёт дольше учётной записи, которая её создала.
        actorUserId: null,
        eventType: "report_shared",
        payload: { reportId: report.id, to: input.to, delivered },
      });

      return { sent: delivered, delivered, token: share.token, url: reportUrl(share.token) };
    }),
});
