import { and, desc, eq, gte, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import type { Database } from "./client";
import { agencies, clients, users } from "./schema/tenancy";
import type { Agency, Client, NewClient, User } from "./schema/tenancy";
import { apiKeys, invitations } from "./schema/auth";
import type { ApiKey, NewApiKey } from "./schema/auth";
import { assistantTraffic } from "./schema/analytics";
import type { AssistantTraffic, NewAssistantTraffic } from "./schema/analytics";
import { paymentEvents, subscriptions, usageCounters } from "./schema/billing";
import { citationSources, sources } from "./schema/sources";
import { actions } from "./schema/actions";
import { activityLog } from "./schema/activity";
import { experimentEvents, experiments } from "./schema/experiments";
import { opportunities } from "./schema/opportunities";
import type { Opportunity } from "./schema/opportunities";
import { reportShares, reports } from "./schema/reports";
import type { NewReport, Report, ReportShare } from "./schema/reports";
import type { Experiment, ExperimentEvent, NewExperiment, NewExperimentEvent } from "./schema/experiments";
import type { ActivityEntry, NewActivityEntry } from "./schema/activity";
import type { Action, NewAction } from "./schema/actions";
import type { Source } from "./schema/sources";
import type { NewSubscription, Subscription, UsageCounter } from "./schema/billing";
type SourceTypeValue = NonNullable<Source["sourceType"]>;
import type { platformEnum } from "./schema/measurement";
type PlatformValue = (typeof platformEnum.enumValues)[number];
import {
  citations,
  mentions,
  promptClusters,
  prompts,
  responses,
  runSchedules,
  runs,
  visibilitySnapshots,
} from "./schema/measurement";
import type {
  Citation,
  Mention,
  NewCitation,
  NewMention,
  NewResponse,
  NewRun,
  Prompt,
  Response,
  NewPrompt,
  NewPromptCluster,
  PromptCluster,
  Run,
  RunSchedule,
  NewVisibilitySnapshotRow,
  VisibilitySnapshotRow,
} from "./schema/measurement";

/**
 * Запросы живут здесь, а не в приложениях: drizzle не должен утекать за границу @repo/db.
 * Эти функции НЕ заменяют tenancy guard — они лишь принимают agencyId, а проверку
 * принадлежности делает assertTenant на стороне API (инвариант 1 в CLAUDE.md).
 */

export async function getAgencyById(db: Database, agencyId: string): Promise<Agency | undefined> {
  const rows = await db.select().from(agencies).where(eq(agencies.id, agencyId)).limit(1);
  return rows[0];
}

export async function createAgency(
  db: Database,
  values: { name: string; clientLimit?: number },
): Promise<Agency> {
  const rows = await db.insert(agencies).values(values).returning();
  const created = rows[0];
  if (!created) {
    throw new Error("Failed to create agency");
  }
  return created;
}

/** Каскадом удаляет пользователей и клиентов агентства. Используется в тестах. */
export async function deleteAgency(db: Database, agencyId: string): Promise<void> {
  await db.delete(agencies).where(eq(agencies.id, agencyId));
}

export async function updateAgency(
  db: Database,
  agencyId: string,
  patch: Partial<Pick<Agency, "name" | "logoUrl" | "brandColor">>,
): Promise<Agency | undefined> {
  const rows = await db.update(agencies).set(patch).where(eq(agencies.id, agencyId)).returning();
  return rows[0];
}

/**
 * Производные от подписки поля агентства.
 *
 * Отдельно от `updateAgency`: план и лимит меняет только вебхук провайдера,
 * и они не должны случайно попасть в форму настроек как редактируемые.
 */
export async function applyPlanToAgency(
  db: Database,
  agencyId: string,
  plan: Agency["plan"],
  clientLimit: number,
): Promise<void> {
  await db.update(agencies).set({ plan, clientLimit }).where(eq(agencies.id, agencyId));
}

export async function listClientsByAgency(db: Database, agencyId: string): Promise<Client[]> {
  return db.select().from(clients).where(eq(clients.agencyId, agencyId));
}

/**
 * Возвращает клиента по id БЕЗ фильтра по агентству — намеренно.
 * Вызывающий обязан прогнать результат через assertTenant, чтобы чужой ресурс
 * и несуществующий давали одинаковый ответ.
 */
export async function getClientById(db: Database, clientId: string): Promise<Client | undefined> {
  const rows = await db.select().from(clients).where(eq(clients.id, clientId)).limit(1);
  return rows[0];
}

export async function countClientsByAgency(db: Database, agencyId: string): Promise<number> {
  const rows = await db.select().from(clients).where(eq(clients.agencyId, agencyId));
  return rows.length;
}

export async function createClient(db: Database, values: NewClient): Promise<Client> {
  const rows = await db.insert(clients).values(values).returning();
  const created = rows[0];
  if (!created) {
    throw new Error("Failed to create client");
  }
  return created;
}

export async function updateClient(
  db: Database,
  clientId: string,
  patch: Partial<Omit<Client, "id" | "agencyId" | "createdAt">>,
): Promise<Client | undefined> {
  const rows = await db.update(clients).set(patch).where(eq(clients.id, clientId)).returning();
  return rows[0];
}

export async function deleteClient(db: Database, clientId: string): Promise<void> {
  await db.delete(clients).where(eq(clients.id, clientId));
}

/**
 * Расписания, которым пора запускаться. Активные, с наступившим next_run_at.
 * Расписание без next_run_at считается ещё не запланированным и не подхватывается —
 * иначе первый же тик запустил бы прогоны по всем клиентам сразу.
 */
export async function listDueSchedules(db: Database, now: Date): Promise<RunSchedule[]> {
  return db
    .select()
    .from(runSchedules)
    .where(
      and(
        eq(runSchedules.active, true),
        isNotNull(runSchedules.nextRunAt),
        lte(runSchedules.nextRunAt, now),
      ),
    );
}

export async function setScheduleNextRun(
  db: Database,
  scheduleId: string,
  nextRunAt: Date,
): Promise<void> {
  await db.update(runSchedules).set({ nextRunAt }).where(eq(runSchedules.id, scheduleId));
}

export async function createRun(db: Database, values: NewRun): Promise<Run> {
  const rows = await db.insert(runs).values(values).returning();
  const created = rows[0];
  if (!created) {
    throw new Error("Failed to create run");
  }
  return created;
}

export async function listRunsByClient(db: Database, clientId: string): Promise<Run[]> {
  return db.select().from(runs).where(eq(runs.clientId, clientId));
}

export async function listActivePromptsForClient(db: Database, clientId: string): Promise<Prompt[]> {
  return db
    .select({
      id: prompts.id,
      clusterId: prompts.clusterId,
      text: prompts.text,
      isControl: prompts.isControl,
      language: prompts.language,
      geo: prompts.geo,
      active: prompts.active,
      createdAt: prompts.createdAt,
    })
    .from(prompts)
    .innerJoin(promptClusters, eq(prompts.clusterId, promptClusters.id))
    .where(and(eq(promptClusters.clientId, clientId), eq(prompts.active, true)));
}

export async function getRunById(db: Database, runId: string): Promise<Run | undefined> {
  const rows = await db.select().from(runs).where(eq(runs.id, runId)).limit(1);
  return rows[0];
}

export async function getRunSchedule(
  db: Database,
  scheduleId: string,
): Promise<RunSchedule | undefined> {
  const rows = await db.select().from(runSchedules).where(eq(runSchedules.id, scheduleId)).limit(1);
  return rows[0];
}

export async function startRun(db: Database, runId: string): Promise<void> {
  await db.update(runs).set({ status: "running" }).where(eq(runs.id, runId));
}

export async function finishRun(
  db: Database,
  runId: string,
  status: "done" | "failed",
): Promise<void> {
  await db.update(runs).set({ status, finishedAt: new Date() }).where(eq(runs.id, runId));
}

/**
 * Забирает ожидающий прогон в работу — ровно один раз.
 *
 * Условие на статус стоит в самом UPDATE, а не проверкой перед ним: два
 * прохода воркера, увидевшие один и тот же pending, иначе оба поставили бы
 * его в очередь, и ассистентов спросили бы дважды за одни деньги.
 */
export async function claimPendingRun(db: Database, runId: string): Promise<boolean> {
  const rows = await db
    .update(runs)
    .set({ status: "running" })
    .where(and(eq(runs.id, runId), eq(runs.status, "pending")))
    .returning({ id: runs.id });
  return rows.length > 0;
}

/** Возвращает забранный прогон в ожидание, если постановка в очередь сорвалась. */
export async function releaseRun(db: Database, runId: string): Promise<void> {
  await db
    .update(runs)
    .set({ status: "pending" })
    .where(and(eq(runs.id, runId), eq(runs.status, "running")));
}

/**
 * Прогоны, которые ждут постановки в очередь.
 *
 * Ручной запуск и аудит в живом режиме создаются вебом, а в очередь их ставит
 * воркер: у веба нет очередей, и сотни вызовов к ассистентам не помещаются
 * в один HTTP-запрос. Режим адаптеров сверяется: прогон, созданный живым,
 * живым и выполняется.
 */
export async function listPendingRuns(
  db: Database,
  mode: "mock" | "live",
  since: Date,
): Promise<{ id: string; clientId: string }[]> {
  return db
    .select({ id: runs.id, clientId: runs.clientId })
    .from(runs)
    .where(and(eq(runs.status, "pending"), eq(runs.adaptersMode, mode), gte(runs.startedAt, since)));
}

/**
 * Закрывает как неудавшиеся прогоны, прождавшие дольше `before`.
 *
 * Такой прогон никто уже не ждёт: запускать его сейчас значило бы потратить
 * деньги на замер, о котором давно забыли, и подписать его старой датой.
 * Статус failed честнее вечного pending — в истории прогонов он виден.
 */
export async function failStalePendingRuns(
  db: Database,
  mode: "mock" | "live",
  before: Date,
): Promise<string[]> {
  const rows = await db
    .update(runs)
    .set({ status: "failed", finishedAt: new Date() })
    .where(
      and(eq(runs.status, "pending"), eq(runs.adaptersMode, mode), sql`${runs.startedAt} < ${before.toISOString()}::timestamptz`),
    )
    .returning({ id: runs.id });
  return rows.map((row) => row.id);
}

export async function createResponse(db: Database, values: NewResponse): Promise<Response> {
  const rows = await db.insert(responses).values(values).returning();
  const created = rows[0];
  if (!created) {
    throw new Error("Failed to create response");
  }
  return created;
}

export async function updateResponseStorageKey(
  db: Database,
  responseId: string,
  key: string,
): Promise<void> {
  await db.update(responses).set({ rawStorageKey: key }).where(eq(responses.id, responseId));
}

export async function countResponsesByRun(db: Database, runId: string): Promise<number> {
  const rows = await db.select({ id: responses.id }).from(responses).where(eq(responses.runId, runId));
  return rows.length;
}

export async function listResponsesByRun(db: Database, runId: string): Promise<Response[]> {
  return db.select().from(responses).where(eq(responses.runId, runId));
}

export async function getResponseById(
  db: Database,
  responseId: string,
): Promise<Response | undefined> {
  const rows = await db.select().from(responses).where(eq(responses.id, responseId)).limit(1);
  return rows[0];
}

/** Клиент, которому принадлежит ответ — нужен парсеру для словаря брендов. */
export async function getClientForResponse(
  db: Database,
  responseId: string,
): Promise<Client | undefined> {
  const rows = await db
    .select({ client: clients })
    .from(responses)
    .innerJoin(runs, eq(responses.runId, runs.id))
    .innerJoin(clients, eq(runs.clientId, clients.id))
    .where(eq(responses.id, responseId))
    .limit(1);
  return rows[0]?.client;
}

export async function replaceMentions(
  db: Database,
  responseId: string,
  values: NewMention[],
): Promise<void> {
  // Переразбор должен быть идемпотентным: старые упоминания удаляются целиком,
  // иначе улучшение парсера удваивало бы данные (инвариант 6 — переобработка).
  await db.delete(mentions).where(eq(mentions.responseId, responseId));
  if (values.length > 0) {
    await db.insert(mentions).values(values);
  }
}

export async function replaceCitations(
  db: Database,
  responseId: string,
  values: NewCitation[],
): Promise<void> {
  await db.delete(citations).where(eq(citations.responseId, responseId));
  if (values.length > 0) {
    await db.insert(citations).values(values);
  }
}

export async function listMentionsByResponse(
  db: Database,
  responseId: string,
): Promise<Mention[]> {
  return db.select().from(mentions).where(eq(mentions.responseId, responseId));
}

export async function listCitationsByResponse(
  db: Database,
  responseId: string,
): Promise<Citation[]> {
  return db.select().from(citations).where(eq(citations.responseId, responseId));
}

/** Ответы клиента с признаками упоминаний — вход агрегации (контракт C3). */
/**
 * Режим, в котором клиент считается измеренным.
 *
 * Живой, если по нему был хотя бы один живой прогон: с этого момента фикстуры
 * в метрики не попадают, даже если кто-то нажал «Run» на стенде в mock-режиме.
 * Клиент, которого меряли только фикстурами (разработка, e2e), продолжает
 * считаться как раньше — иначе на стенде не осталось бы вообще никаких чисел.
 */
export async function effectiveAdaptersMode(
  db: Database,
  clientId: string,
): Promise<"mock" | "live"> {
  const rows = await db
    .select({ id: runs.id })
    .from(runs)
    .where(and(eq(runs.clientId, clientId), eq(runs.adaptersMode, "live")))
    .limit(1);

  return rows.length > 0 ? "live" : "mock";
}

export async function listResponseFactsForClient(db: Database, clientId: string) {
  const mode = await effectiveAdaptersMode(db, clientId);

  const rows = await db
    .select({
      responseId: responses.id,
      clusterId: prompts.clusterId,
      platform: responses.platform,
      createdAt: responses.createdAt,
      entityName: mentions.entityName,
      isClient: mentions.isClient,
      isCompetitor: mentions.isCompetitor,
    })
    .from(responses)
    .innerJoin(runs, eq(responses.runId, runs.id))
    .innerJoin(prompts, eq(responses.promptId, prompts.id))
    .leftJoin(mentions, eq(mentions.responseId, responses.id))
    .where(and(eq(runs.clientId, clientId), eq(runs.adaptersMode, mode)));

  return rows;
}

/**
 * Живо ли соединение с базой. Используется проверкой готовности контейнера:
 * инстанс без базы не должен принимать трафик.
 */
export async function pingDatabase(db: Database): Promise<void> {
  const rows = await db.execute(sql`select 1 as ok`);
  const ok = (rows as unknown as { ok: number }[])[0]?.ok;

  if (ok !== 1) {
    throw new Error("Database did not answer the liveness query");
  }
}

/* ---------- Ключи публичного API ---------- */

export async function createApiKey(db: Database, values: NewApiKey): Promise<ApiKey> {
  const rows = await db.insert(apiKeys).values(values).returning();
  const created = rows[0];
  if (!created) {
    throw new Error("Failed to create API key");
  }
  return created;
}

export async function listApiKeys(db: Database, agencyId: string): Promise<ApiKey[]> {
  return db
    .select()
    .from(apiKeys)
    .where(eq(apiKeys.agencyId, agencyId))
    .orderBy(desc(apiKeys.createdAt));
}

/**
 * Ключ по открытому префиксу. Хэши не перебираются: сравнение делает
 * вызывающий, за постоянное время.
 */
export async function findApiKeyByPrefix(
  db: Database,
  prefix: string,
): Promise<ApiKey | undefined> {
  const rows = await db.select().from(apiKeys).where(eq(apiKeys.prefix, prefix)).limit(1);
  return rows[0];
}

/** Отзыв, а не удаление: история использования ключа остаётся видимой. */
export async function revokeApiKey(db: Database, id: string, agencyId: string): Promise<void> {
  await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, id), eq(apiKeys.agencyId, agencyId)));
}

export async function touchApiKey(db: Database, id: string): Promise<void> {
  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, id));
}

/* ---------- Переходы от ассистентов ---------- */

/**
 * Записывает импортированный трафик. Повторный импорт того же дня
 * перезаписывает строку: агентство должно иметь право прислать файл дважды,
 * не удвоив цифру.
 */
export async function upsertAssistantTraffic(
  db: Database,
  rows: NewAssistantTraffic[],
): Promise<number> {
  if (rows.length === 0) {
    return 0;
  }

  await db
    .insert(assistantTraffic)
    .values(rows)
    .onConflictDoUpdate({
      target: [assistantTraffic.clientId, assistantTraffic.day, assistantTraffic.assistant],
      set: { sessions: sql`excluded.sessions`, updatedAt: new Date() },
    });

  return rows.length;
}

export async function listAssistantTraffic(
  db: Database,
  clientId: string,
): Promise<AssistantTraffic[]> {
  return db
    .select()
    .from(assistantTraffic)
    .where(eq(assistantTraffic.clientId, clientId))
    .orderBy(assistantTraffic.day);
}

export interface PortfolioRow {
  clientId: string;
  name: string;
  domain: string;
  status: Client["status"];
  visibilityPct: number | null;
  competitorVisibility: Record<string, number>;
  sampleCount: number;
  sufficient: boolean;
  deltaPp: number | null;
  /**
   * Кем измерены две последние недели.
   *
   * Отдаются как есть, а не в виде вывода: доля считается от тех ответов,
   * что есть, и сравнивать два среза можно только при одинаковом составе, —
   * но решает это слой выше. Схема о правилах сравнения не знает.
   */
  latestAssistants: string[];
  previousAssistants: string[];
  /** Кого расписание просит спрашивать. Пусто — расписания ещё нет. */
  scheduledAssistants: string[];
  openActions: number;
  staleActions: number;
  reportsAwaitingApproval: number;
  lastRunAt: Date | null;
  /** Открытые возможности: то, ради чего агентство сюда заходит. */
  openOpportunities: number;
  highPriorityOpportunities: number;
  newOpportunities: number;
  topOpportunityScore: number | null;
}

/**
 * Портфель агентства: по строке на клиента.
 *
 * Считается из уже посчитанных срезов, а не из ответов: экран открывается
 * на каждом заходе в продукт, и пересчитывать по нему всю историю значит
 * платить временем за то, что уже посчитано воркером.
 *
 * Клиент, не набравший порог сэмплов, приезжает с `sufficient: false` —
 * интерфейс обязан показать прочерк, а не число.
 */
export async function listPortfolioRows(
  db: Database,
  agencyId: string,
  now: Date = new Date(),
  /** Порог «высокого» приоритета — продуктовое решение, приходит снаружи. */
  highPriorityScore = 70,
): Promise<PortfolioRow[]> {
  const agencyClients = await db
    .select()
    .from(clients)
    .where(eq(clients.agencyId, agencyId))
    .orderBy(clients.createdAt);

  if (agencyClients.length === 0) {
    return [];
  }

  const ids = agencyClients.map((client) => client.id);

  /**
   * Срезы по всем клиентам разом — и свёртки, и разрезы по платформам.
   *
   * Разрезы нужны, чтобы понять, одним ли составом измерены две последние
   * недели: доля считается от тех ответов, что есть, и включённый или
   * выключенный ассистент двигает её сам по себе. Отдельным запросом это
   * был бы второй проход по той же таблице, поэтому берётся одним, а
   * разделяется в памяти.
   */
  const allSnapshots = await db
    .select()
    .from(visibilitySnapshots)
    .where(
      and(inArray(visibilitySnapshots.clientId, ids), isNull(visibilitySnapshots.clusterId)),
    )
    .orderBy(visibilitySnapshots.periodStart);

  const snapshots = allSnapshots.filter((row) => row.platform === null);

  const byClient = new Map<string, typeof snapshots>();
  for (const snapshot of snapshots) {
    const list = byClient.get(snapshot.clientId) ?? [];
    list.push(snapshot);
    byClient.set(snapshot.clientId, list);
  }

  /** Кто отвечал в этой неделе у этого клиента. */
  const measuredIn = (clientId: string, week: Date | undefined): string[] =>
    week === undefined
      ? []
      : allSnapshots
          .filter(
            (row) =>
              row.clientId === clientId &&
              row.platform !== null &&
              row.sampleCount > 0 &&
              row.periodStart.getTime() === week.getTime(),
          )
          .map((row) => row.platform as string);

  /**
   * Что настроено измерять у каждого клиента.
   *
   * Настроено, а не измерено: срезы выше говорят, кто отвечал, а здесь —
   * кого просили спросить. Разница между этими двумя списками и есть то,
   * о чём агентству надо сказать, и увидеть её можно только рядом.
   */
  const scheduleRows = await db
    .select({ clientId: runSchedules.clientId, platforms: runSchedules.platforms })
    .from(runSchedules)
    .where(inArray(runSchedules.clientId, ids));

  const scheduledByClient = new Map<string, string[]>(
    scheduleRows.map((row) => [row.clientId, row.platforms as string[]]),
  );

  const actionRows = await db
    .select({
      clientId: actions.clientId,
      status: actions.status,
      createdAt: actions.createdAt,
    })
    .from(actions)
    .where(inArray(actions.clientId, ids));

  const pendingApprovals = await db
    .select({ clientId: reports.clientId, shareId: reportShares.id })
    .from(reportShares)
    .innerJoin(reports, eq(reportShares.reportId, reports.id))
    .where(and(inArray(reports.clientId, ids), isNull(reportShares.approvedAt)));

  const lastRuns = await db
    .select({ clientId: runs.clientId, finishedAt: runs.finishedAt, startedAt: runs.startedAt })
    .from(runs)
    .where(inArray(runs.clientId, ids));

  /** Действие считается зависшим, если оно висит открытым дольше двух недель. */
  const staleBefore = new Date(now.getTime() - 14 * 86_400_000);

  // Возможности приезжают одним сгруппированным запросом: экран портфеля
  // открывается на каждом заходе, и запрос на клиента дал бы N+1.
  const opportunityCounts = await listOpportunityCounts(db, ids, {
    highPriorityScore,
    since: new Date(now.getTime() - 7 * 86_400_000),
  });
  const countsByClient = new Map(opportunityCounts.map((row) => [row.clientId, row]));

  return agencyClients.map((client): PortfolioRow => {
    const series = byClient.get(client.id) ?? [];
    const latest = series.at(-1);
    const previous = series.length > 1 ? series[series.length - 2] : undefined;

    const clientActions = actionRows.filter((row) => row.clientId === client.id);
    const open = clientActions.filter(
      (row) => row.status !== "done" && row.status !== "dropped",
    );

    const clientRuns = lastRuns.filter((row) => row.clientId === client.id);
    const lastRunAt = clientRuns
      .map((row) => row.finishedAt ?? row.startedAt)
      .filter((value): value is Date => value !== null)
      .sort((a, b) => b.getTime() - a.getTime())[0];

    const latestPct = latest ? Number(latest.clientVisibilityPct) : null;
    const previousPct = previous ? Number(previous.clientVisibilityPct) : null;



    return {
      clientId: client.id,
      name: client.name,
      domain: client.domain,
      status: client.status,
      // Ниже порога цифры нет вовсе: показать её значило бы выдать догадку.
      visibilityPct: latest?.sufficient ? latestPct : null,
      competitorVisibility: latest?.competitorVisibility ?? {},
      sampleCount: latest?.sampleCount ?? 0,
      sufficient: latest?.sufficient ?? false,
      deltaPp:
        latest?.sufficient && previous?.sufficient && latestPct !== null && previousPct !== null
          ? Math.round((latestPct - previousPct) * 10) / 10
          : null,
      latestAssistants: measuredIn(client.id, latest?.periodStart),
      previousAssistants: measuredIn(client.id, previous?.periodStart),
      scheduledAssistants: scheduledByClient.get(client.id) ?? [],
      openActions: open.length,
      staleActions: open.filter((row) => row.createdAt.getTime() < staleBefore.getTime()).length,
      reportsAwaitingApproval: pendingApprovals.filter((row) => row.clientId === client.id).length,
      lastRunAt: lastRunAt ?? null,
      openOpportunities: countsByClient.get(client.id)?.open ?? 0,
      highPriorityOpportunities: countsByClient.get(client.id)?.highPriority ?? 0,
      newOpportunities: countsByClient.get(client.id)?.newRecently ?? 0,
      topOpportunityScore: countsByClient.get(client.id)?.topScore ?? null,
    };
  });
}

/**
 * Факты для матрицы «промпт × ассистент» за окно.
 *
 * Отличается от `listResponseFactsForClient` двумя вещами: несёт сам промпт
 * (матрица разложена по вопросам, а не по кластерам) и ограничена окном —
 * матрица считается за 28 дней, чтобы ячейки набирали порог сэмплов без
 * увеличения расхода. Фильтр по эффективному режиму адаптеров тот же:
 * фикстурный прогон не должен попадать в измерение.
 */
export async function listPromptPlatformFacts(
  db: Database,
  clientId: string,
  from: Date,
  to: Date,
) {
  const mode = await effectiveAdaptersMode(db, clientId);

  return db
    .select({
      responseId: responses.id,
      promptId: responses.promptId,
      promptText: prompts.text,
      clusterId: prompts.clusterId,
      platform: responses.platform,
      createdAt: responses.createdAt,
      entityName: mentions.entityName,
      isClient: mentions.isClient,
      isCompetitor: mentions.isCompetitor,
      // Порядок появления бренда в ответе: по нему считается заметность —
      // назван первым или четвёртым в списке «а ещё бывают».
      position: mentions.position,
    })
    .from(responses)
    .innerJoin(runs, eq(responses.runId, runs.id))
    .innerJoin(prompts, eq(responses.promptId, prompts.id))
    .leftJoin(mentions, eq(mentions.responseId, responses.id))
    .where(
      and(
        eq(runs.clientId, clientId),
        eq(runs.adaptersMode, mode),
        gte(responses.createdAt, from),
        lte(responses.createdAt, to),
      ),
    );
}

/**
 * Идемпотентная запись среза. Уникального ограничения в БД нет (см. комментарий
 * к индексу в схеме), поэтому существующая строка ищется явно.
 */
export async function upsertVisibilitySnapshot(
  db: Database,
  values: NewVisibilitySnapshotRow,
): Promise<void> {
  const existing = await db
    .select({ id: visibilitySnapshots.id })
    .from(visibilitySnapshots)
    .where(
      and(
        eq(visibilitySnapshots.clientId, values.clientId),
        values.clusterId == null
          ? isNull(visibilitySnapshots.clusterId)
          : eq(visibilitySnapshots.clusterId, values.clusterId),
        values.platform == null
          ? isNull(visibilitySnapshots.platform)
          : eq(visibilitySnapshots.platform, values.platform),
        eq(visibilitySnapshots.periodStart, values.periodStart),
      ),
    )
    .limit(1);

  const row = existing[0];
  if (row) {
    await db
      .update(visibilitySnapshots)
      .set({
        clientVisibilityPct: values.clientVisibilityPct,
        competitorVisibility: values.competitorVisibility,
        sampleCount: values.sampleCount,
        sufficient: values.sufficient,
      })
      .where(eq(visibilitySnapshots.id, row.id));
    return;
  }

  await db.insert(visibilitySnapshots).values(values);
}

/**
 * Срезы для графика. clusterId/platform === null означает свёртку —
 * именно её показываем по умолчанию, потому что видимость по одной платформе
 * это не видимость клиента, а её часть.
 */
export async function listVisibilitySeries(
  db: Database,
  clientId: string,
  filter: { clusterId?: string | null; platform?: PlatformValue | null } = {},
): Promise<VisibilitySnapshotRow[]> {
  const clusterCondition =
    filter.clusterId == null
      ? isNull(visibilitySnapshots.clusterId)
      : eq(visibilitySnapshots.clusterId, filter.clusterId);

  const platformCondition =
    filter.platform == null
      ? isNull(visibilitySnapshots.platform)
      : eq(visibilitySnapshots.platform, filter.platform);

  return db
    .select()
    .from(visibilitySnapshots)
    .where(
      and(eq(visibilitySnapshots.clientId, clientId), clusterCondition, platformCondition),
    )
    .orderBy(visibilitySnapshots.periodStart);
}

export async function listVisibilitySnapshots(
  db: Database,
  clientId: string,
): Promise<VisibilitySnapshotRow[]> {
  return db
    .select()
    .from(visibilitySnapshots)
    .where(eq(visibilitySnapshots.clientId, clientId));
}

/** Инкремент расхода. Атомарен: несколько job'ов пишут в одну строку параллельно. */
export async function incrementAiChecks(
  db: Database,
  agencyId: string,
  period: string,
  delta = 1,
): Promise<void> {
  await db
    .insert(usageCounters)
    .values({ agencyId, period, aiChecksUsed: delta })
    .onConflictDoUpdate({
      target: [usageCounters.agencyId, usageCounters.period],
      set: {
        aiChecksUsed: sql`${usageCounters.aiChecksUsed} + ${delta}`,
        updatedAt: new Date(),
      },
    });
}

export interface CostRow {
  clientId: string;
  clientName: string;
  platform: PlatformValue;
  responses: number;
  costUsd: string;
}

/**
 * Стоимость измерений за период по клиентам и платформам.
 *
 * Сумма считается в БД, а не в приложении: строк ответов на агентство — тысячи
 * за месяц, и тянуть их в память ради сложения бессмысленно. numeric остаётся
 * строкой (инвариант «деньги — numeric»), округление — на стороне отображения.
 */
export async function listCostsByClientAndPlatform(
  db: Database,
  agencyId: string,
  from: Date,
  to: Date,
): Promise<CostRow[]> {
  const rows = await db
    .select({
      clientId: clients.id,
      clientName: clients.name,
      platform: responses.platform,
      responses: sql<string>`count(*)`,
      costUsd: sql<string>`coalesce(sum(${responses.costUsd}), 0)`,
    })
    .from(responses)
    .innerJoin(runs, eq(runs.id, responses.runId))
    .innerJoin(clients, eq(clients.id, runs.clientId))
    .where(
      and(
        eq(clients.agencyId, agencyId),
        // Прогоны на фикстурах денег не стоят: их стоимость записана в
        // ответах, но никто её не платил. Смешивать её с настоящим счётом —
        // значит показывать агентству расход, которого не было.
        eq(runs.adaptersMode, "live"),
        gte(responses.createdAt, from),
        lte(responses.createdAt, to),
      ),
    )
    .groupBy(clients.id, clients.name, responses.platform)
    .orderBy(clients.name, responses.platform);

  return rows.map((row) => ({
    clientId: row.clientId,
    clientName: row.clientName,
    platform: row.platform,
    responses: Number(row.responses),
    costUsd: String(row.costUsd),
  }));
}

/**
 * Сколько ответов за период получено на фикстурах.
 *
 * Их нет в счёте, но сказать о них надо: иначе агентство видит на странице
 * измерения, которых «не было», и не понимает, почему числа не сходятся.
 */
export async function countFixtureAnswers(
  db: Database,
  agencyId: string,
  from: Date,
  to: Date,
): Promise<number> {
  const rows = await db
    .select({ total: sql<string>`count(*)` })
    .from(responses)
    .innerJoin(runs, eq(runs.id, responses.runId))
    .innerJoin(clients, eq(clients.id, runs.clientId))
    .where(
      and(
        eq(clients.agencyId, agencyId),
        eq(runs.adaptersMode, "mock"),
        gte(responses.createdAt, from),
        lte(responses.createdAt, to),
      ),
    );

  return Number(rows[0]?.total ?? 0);
}

/**
 * Который час по часам базы.
 *
 * Отметки времени на ответах ставит Postgres (`defaultNow()`), а границы
 * окон до сих пор брались у Node. Часы расходятся — на этой машине база
 * опережает приложение почти на полсекунды, — и только что записанный
 * ответ оказывался «в будущем» относительно верхней границы окна: он
 * выпадал из расчёта, пока разница не истечёт.
 *
 * В интерфейсе это полсекунды невидимой свежести, в тестах — падение
 * через раз. Лечится не ожиданием, а тем, что обе величины берутся из
 * одного источника.
 */
export async function databaseNow(db: Database): Promise<Date> {
  const rows = await db.execute<{ now: Date }>(sql`select now() as now`);
  const value = (rows as unknown as { rows?: { now: Date }[] }).rows?.[0]?.now;
  return value ? new Date(value) : new Date();
}

export async function getUsageCounter(
  db: Database,
  agencyId: string,
  period: string,
): Promise<UsageCounter | undefined> {
  const rows = await db
    .select()
    .from(usageCounters)
    .where(and(eq(usageCounters.agencyId, agencyId), eq(usageCounters.period, period)))
    .limit(1);
  return rows[0];
}

/**
 * Сколько проверок агентство израсходовало за всё время.
 *
 * Счётчик ведётся по месяцам ради счёта плательщику, а бесплатный аудит —
 * один на аккаунт. Брать для него месячную строку значило бы выдавать новый
 * аудит первого числа каждого месяца, бессрочно.
 */
export async function getLifetimeAiChecks(db: Database, agencyId: string): Promise<number> {
  const rows = await db
    .select({ total: sql<number>`coalesce(sum(${usageCounters.aiChecksUsed}), 0)::int` })
    .from(usageCounters)
    .where(eq(usageCounters.agencyId, agencyId));
  return rows[0]?.total ?? 0;
}

/**
 * Блокировка агентства до конца текущей транзакции.
 *
 * Для пар «проверить лимит — вставить», которые иначе проходят параллельно:
 * старт прогона, заведение клиента. Вне транзакции бессмысленна — снимается
 * сразу.
 */
export async function lockAgency(db: Database, agencyId: string): Promise<void> {
  await db.execute(sql`select pg_advisory_xact_lock(hashtext(${agencyId}))`);
}

/**
 * Сколько ответов агентству разрешено живыми прогонами — с `since` или за
 * всё время.
 *
 * Счётчик расхода растёт, когда ответ уже записан, а этот — когда прогон
 * одобрен. Разница — идущие прогоны и платные вызовы, упавшие до записи:
 * по счётчику их не видно, а деньги за них ушли. Прогоны в mock-режиме не
 * стоят ничего и не считаются.
 */
export async function sumPlannedChecks(
  db: Database,
  agencyId: string,
  since: Date | null = null,
): Promise<number> {
  const rows = await db
    .select({ total: sql<number>`coalesce(sum(${runs.plannedChecks}), 0)::int` })
    .from(runs)
    .innerJoin(clients, eq(runs.clientId, clients.id))
    .where(
      and(
        eq(clients.agencyId, agencyId),
        eq(runs.adaptersMode, "live"),
        since ? gte(runs.startedAt, since) : undefined,
      ),
    );
  return rows[0]?.total ?? 0;
}

/**
 * Сколько прогонов агентства ещё идёт.
 *
 * Только за последние сутки: прогон, застрявший в «running» после падения
 * воркера, иначе навсегда закрыл бы бесплатному аккаунту его единственный
 * аудит.
 */
export async function countRunsInFlight(
  db: Database,
  agencyId: string,
  now: Date = new Date(),
): Promise<number> {
  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const rows = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(runs)
    .innerJoin(clients, eq(runs.clientId, clients.id))
    .where(
      and(
        eq(clients.agencyId, agencyId),
        inArray(runs.status, ["pending", "running"]),
        // started_at ставится при вставке, так что у ожидающего это время создания.
        gte(runs.startedAt, since),
      ),
    );
  return rows[0]?.n ?? 0;
}

/**
 * Подписка агентства. Права доступа считаются от неё (контракт entitlements
 * в @repo/core), а `agencies.plan` и `agencies.client_limit` — производные.
 */
export async function getSubscriptionByAgency(
  db: Database,
  agencyId: string,
): Promise<Subscription | undefined> {
  const rows = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.agencyId, agencyId))
    .limit(1);
  return rows[0];
}

/**
 * Подписка по плательщику: в событиях провайдера агентство есть не всегда,
 * а плательщик — всегда, и по нему находится уже записанная подписка.
 */
export async function getSubscriptionByCustomer(
  db: Database,
  customerId: string,
): Promise<Subscription | undefined> {
  const rows = await db
    .select()
    .from(subscriptions)
    .where(eq(subscriptions.customerId, customerId))
    .limit(1);
  return rows[0];
}

/** Записывает состояние подписки. Одна подписка на агентство — отсюда upsert. */
export async function upsertSubscription(
  db: Database,
  values: NewSubscription,
): Promise<Subscription> {
  const rows = await db
    .insert(subscriptions)
    .values(values)
    .onConflictDoUpdate({
      target: subscriptions.agencyId,
      set: {
        customerId: values.customerId,
        subscriptionId: values.subscriptionId ?? null,
        plan: values.plan,
        status: values.status,
        currentPeriodEnd: values.currentPeriodEnd ?? null,
        cancelAtPeriodEnd: values.cancelAtPeriodEnd ?? false,
        // Отметка о событии обновляется вместе с состоянием, а не только при
        // первой записи: по ней отбрасывается задержавшийся повтор более
        // раннего события, а первая запись у подписки ровно одна.
        lastEventAt: values.lastEventAt ?? null,
        // `extraClientAccounts` здесь намеренно нет: событие провайдера его
        // не несёт, и перезапись обнулила бы докупленные аккаунты — агентство
        // с сорока клиентами получило бы потолок в двадцать пять.
        updatedAt: new Date(),
      },
    })
    .returning();

  const saved = rows[0];
  if (!saved) {
    throw new Error("Failed to save subscription");
  }
  return saved;
}

/** Агентство, которому принадлежит прогон — нужно для учёта расхода. */
export async function getAgencyIdForRun(db: Database, runId: string): Promise<string | undefined> {
  const rows = await db
    .select({ agencyId: clients.agencyId })
    .from(runs)
    .innerJoin(clients, eq(runs.clientId, clients.id))
    .where(eq(runs.id, runId))
    .limit(1);
  return rows[0]?.agencyId;
}

/** Ответы на промпт вместе с разобранными упоминаниями и ссылками. */
export async function listResponsesForPrompt(db: Database, promptId: string, limit = 30) {
  const rows = await db
    .select()
    .from(responses)
    .where(eq(responses.promptId, promptId))
    .orderBy(desc(responses.createdAt))
    .limit(limit);

  return Promise.all(
    rows.map(async (response) => ({
      id: response.id,
      platform: response.platform,
      modelVersion: response.modelVersion,
      sampleIndex: response.sampleIndex,
      rawText: response.rawText,
      costUsd: response.costUsd,
      latencyMs: response.latencyMs,
      createdAt: response.createdAt,
      mentions: await listMentionsByResponse(db, response.id),
      citations: await listCitationsByResponse(db, response.id),
    })),
  );
}

export async function getScheduleForClient(
  db: Database,
  clientId: string,
): Promise<RunSchedule | undefined> {
  const rows = await db
    .select()
    .from(runSchedules)
    .where(eq(runSchedules.clientId, clientId))
    .limit(1);
  return rows[0];
}

/** У клиента одно расписание: повторный вызов обновляет существующее. */
/**
 * Расписание клиента. Одно на клиента — это держит уникальный индекс, а не
 * порядок чтения-записи: два одновременных сохранения раньше оставляли два
 * расписания, и каждый тик заводил по прогону на каждое.
 */
export async function upsertRunSchedule(
  db: Database,
  clientId: string,
  values: Pick<RunSchedule, "cadence" | "platforms" | "samplesPerPrompt" | "active">,
): Promise<RunSchedule> {
  const rows = await db
    .insert(runSchedules)
    .values({
      clientId,
      ...values,
      // Первый прогон по расписанию — сразу: иначе агентство создаёт расписание
      // и неделю не понимает, почему данных нет.
      nextRunAt: new Date(),
    })
    .onConflictDoUpdate({
      target: runSchedules.clientId,
      // nextRunAt не трогаем: изменение настроек не должно сдвигать
      // ближайший замер ни вперёд, ни назад.
      set: values,
    })
    .returning();

  return rows[0]!;
}

export async function listRecentRuns(
  db: Database,
  clientId: string,
  limit = 10,
): Promise<Run[]> {
  return db
    .select()
    .from(runs)
    .where(eq(runs.clientId, clientId))
    .orderBy(desc(runs.startedAt))
    .limit(limit);
}

/**
 * Заводит источник, если домена ещё нет. Классификация домена глобальна:
 * один и тот же домен не должен классифицироваться моделью повторно
 * для каждого агентства — это прямые деньги.
 */
export async function ensureSource(
  db: Database,
  domain: string,
  classification?: { sourceType: SourceTypeValue; classifiedBy: string },
): Promise<Source> {
  const existing = await db.select().from(sources).where(eq(sources.domain, domain)).limit(1);
  const found = existing[0];

  if (found) {
    // Уже классифицирован — не перезаписываем: правило не должно затирать
    // более точный результат модели, и наоборот.
    if (found.sourceType === null && classification) {
      const updated = await db
        .update(sources)
        .set({
          sourceType: classification.sourceType,
          classifiedBy: classification.classifiedBy,
          classifiedAt: new Date(),
        })
        .where(eq(sources.id, found.id))
        .returning();
      return updated[0] ?? found;
    }
    return found;
  }

  const inserted = await db
    .insert(sources)
    .values({
      domain,
      sourceType: classification?.sourceType ?? null,
      classifiedBy: classification?.classifiedBy ?? null,
      classifiedAt: classification ? new Date() : null,
    })
    .returning();

  const created = inserted[0];
  if (!created) {
    throw new Error(`Failed to create source for domain ${domain}`);
  }
  return created;
}

export async function getSourceByDomain(
  db: Database,
  domain: string,
): Promise<Source | undefined> {
  const rows = await db.select().from(sources).where(eq(sources.domain, domain)).limit(1);
  return rows[0];
}

export async function listUnclassifiedSources(db: Database, limit = 100): Promise<Source[]> {
  return db.select().from(sources).where(isNull(sources.sourceType)).limit(limit);
}

export async function linkCitationToSource(
  db: Database,
  citationId: string,
  sourceId: string,
): Promise<void> {
  await db.insert(citationSources).values({ citationId, sourceId }).onConflictDoNothing();
}


/**
 * Факты цитирования для диагностики: домен, его тип и кто упомянут
 * в том же ответе. Присутствие в источнике приближается упоминанием
 * в ответе, где источник процитирован (MVP; так и подписано в UI).
 */
export async function listCitationFacts(
  db: Database,
  clientId: string,
  clusterId?: string | null,
) {
  // Фикстуры не смешиваются с живыми измерениями (см. effectiveAdaptersMode).
  const conditions = [
    eq(runs.clientId, clientId),
    eq(runs.adaptersMode, await effectiveAdaptersMode(db, clientId)),
  ];
  if (clusterId) {
    conditions.push(eq(prompts.clusterId, clusterId));
  }

  const rows = await db
    .select({
      responseId: responses.id,
      domain: citations.domain,
      /**
       * Владение считается здесь, а не берётся из `sources`: таблица источников
       * общая на все агентства, а «свой домен» — свойство пары (клиент, домен).
       * Домен клиента и его поддомены — owned, всё остальное — глобальный тип.
       */
      sourceType: sql<string | null>`
        case
          when ${citations.domain} = ${clients.domain}
            or ${citations.domain} like '%.' || ${clients.domain}
          then 'owned'
          else ${sources.sourceType}
        end
      `,
      entityName: mentions.entityName,
      isClient: mentions.isClient,
      isCompetitor: mentions.isCompetitor,
      /**
       * Промпт и кластер идут в тот же запрос, чтобы диагноз по каждой теме
       * не стоил отдельного полного прохода по цитированиям. Существующие
       * читатели их игнорируют — `toCitationFacts` собирает только нужные поля.
       */
      promptId: responses.promptId,
      clusterId: prompts.clusterId,
    })
    .from(citations)
    .innerJoin(responses, eq(citations.responseId, responses.id))
    .innerJoin(runs, eq(responses.runId, runs.id))
    .innerJoin(clients, eq(clients.id, runs.clientId))
    .innerJoin(prompts, eq(responses.promptId, prompts.id))
    .leftJoin(sources, eq(sources.domain, citations.domain))
    .leftJoin(mentions, eq(mentions.responseId, responses.id))
    .where(and(...conditions));

  return rows;
}

/**
 * Пишет событие в журнал. Никогда не бросает исключение наружу: сбой записи
 * в журнал не должен отменять само действие — потерять запись хуже,
 * чем потерять работу, но отменить выполненную работу хуже всего.
 */
export async function logActivity(db: Database, entry: NewActivityEntry): Promise<void> {
  try {
    await db.insert(activityLog).values(entry);
  } catch (error) {
    console.error("[activity] failed to record event:", error);
  }
}

export async function listActivity(
  db: Database,
  clientId: string,
  limit = 20,
): Promise<ActivityEntry[]> {
  return db
    .select()
    .from(activityLog)
    .where(eq(activityLog.clientId, clientId))
    .orderBy(desc(activityLog.createdAt))
    .limit(limit);
}

/** События за период — материал для раздела «что сделано» в отчёте (T50). */
export async function listActivityBetween(
  db: Database,
  clientId: string,
  from: Date,
  to: Date,
): Promise<ActivityEntry[]> {
  return db
    .select()
    .from(activityLog)
    .where(
      and(
        eq(activityLog.clientId, clientId),
        gte(activityLog.createdAt, from),
        lte(activityLog.createdAt, to),
      ),
    )
    .orderBy(desc(activityLog.createdAt));
}

/** Наблюдения цитирования по кластерам — вход для детекта новых источников. */
export async function listCitationObservations(
  db: Database,
  clientId: string,
  clusterIds: string[],
): Promise<{ domain: string; observedAt: Date }[]> {
  if (clusterIds.length === 0) return [];

  return db
    .select({ domain: citations.domain, observedAt: responses.createdAt })
    .from(citations)
    .innerJoin(responses, eq(citations.responseId, responses.id))
    .innerJoin(runs, eq(responses.runId, runs.id))
    .innerJoin(prompts, eq(responses.promptId, prompts.id))
    .where(and(eq(runs.clientId, clientId), inArray(prompts.clusterId, clusterIds)));
}

/** Эксперименты, которые ещё собирают данные. */
export async function listCollectingExperiments(
  db: Database,
  clientId: string,
): Promise<Experiment[]> {
  return db
    .select()
    .from(experiments)
    .where(and(eq(experiments.clientId, clientId), eq(experiments.status, "collecting")));
}

/** Есть ли уже событие такого типа — детект обязан быть идемпотентным. */
export async function hasExperimentEvent(
  db: Database,
  experimentId: string,
  type: ExperimentEvent["type"],
): Promise<boolean> {
  const rows = await db
    .select({ id: experimentEvents.id })
    .from(experimentEvents)
    .where(and(eq(experimentEvents.experimentId, experimentId), eq(experimentEvents.type, type)))
    .limit(1);
  return rows.length > 0;
}

export async function createReport(db: Database, values: NewReport): Promise<Report> {
  const rows = await db.insert(reports).values(values).returning();
  const created = rows[0];
  if (!created) {
    throw new Error("Failed to create report");
  }
  return created;
}

export async function getReportById(db: Database, reportId: string): Promise<Report | undefined> {
  const rows = await db.select().from(reports).where(eq(reports.id, reportId)).limit(1);
  return rows[0];
}

export async function listReports(db: Database, clientId: string): Promise<Report[]> {
  return db
    .select()
    .from(reports)
    .where(eq(reports.clientId, clientId))
    .orderBy(desc(reports.createdAt));
}

export async function setReportStatus(
  db: Database,
  reportId: string,
  status: Report["status"],
): Promise<void> {
  await db.update(reports).set({ status }).where(eq(reports.id, reportId));
}

export async function setReportPdfKey(
  db: Database,
  reportId: string,
  pdfStorageKey: string,
): Promise<void> {
  await db.update(reports).set({ pdfStorageKey }).where(eq(reports.id, reportId));
}

export async function createReportShare(
  db: Database,
  values: { reportId: string; token: string; expiresAt?: Date | null },
): Promise<ReportShare> {
  const rows = await db
    .insert(reportShares)
    .values({ reportId: values.reportId, token: values.token, expiresAt: values.expiresAt ?? null })
    .returning();
  const created = rows[0];
  if (!created) {
    throw new Error("Failed to create report share");
  }
  return created;
}

export async function getShareByToken(
  db: Database,
  token: string,
): Promise<ReportShare | undefined> {
  const rows = await db.select().from(reportShares).where(eq(reportShares.token, token)).limit(1);
  return rows[0];
}

export async function getShareForReport(
  db: Database,
  reportId: string,
): Promise<ReportShare | undefined> {
  const rows = await db
    .select()
    .from(reportShares)
    .where(eq(reportShares.reportId, reportId))
    .limit(1);
  return rows[0];
}

export async function approveShare(
  db: Database,
  token: string,
  approvedByName: string,
): Promise<void> {
  await db
    .update(reportShares)
    .set({ approvedAt: new Date(), approvedByName })
    .where(eq(reportShares.token, token));
}

/** Действия, завершённые в периоде — материал для раздела «что сделано». */
export async function listActionsCompletedBetween(
  db: Database,
  clientId: string,
  from: Date,
  to: Date,
): Promise<Action[]> {
  return db
    .select()
    .from(actions)
    .where(
      and(
        eq(actions.clientId, clientId),
        eq(actions.status, "done"),
        isNotNull(actions.completedAt),
        gte(actions.completedAt, from),
        lte(actions.completedAt, to),
      ),
    );
}

/** Домены, впервые процитированные в периоде: «новые источники» в отчёте. */
export async function countNewCitedDomains(
  db: Database,
  clientId: string,
  from: Date,
  to: Date,
): Promise<number> {
  const rows = await db
    .select({ domain: citations.domain, observedAt: responses.createdAt })
    .from(citations)
    .innerJoin(responses, eq(citations.responseId, responses.id))
    .innerJoin(runs, eq(responses.runId, runs.id))
    .where(
      and(
        eq(runs.clientId, clientId),
        eq(runs.adaptersMode, await effectiveAdaptersMode(db, clientId)),
      ),
    );

  const before = new Set<string>();
  const during = new Set<string>();

  for (const row of rows) {
    if (row.observedAt < from) {
      before.add(row.domain);
    } else if (row.observedAt <= to) {
      during.add(row.domain);
    }
  }

  return [...during].filter((domain) => !before.has(domain)).length;
}

/** Упоминания клиента в периоде — «новые упоминания бренда» в отчёте. */
export async function countClientMentionsBetween(
  db: Database,
  clientId: string,
  from: Date,
  to: Date,
): Promise<number> {
  const rows = await db
    .select({ id: mentions.id })
    .from(mentions)
    .innerJoin(responses, eq(mentions.responseId, responses.id))
    .innerJoin(runs, eq(responses.runId, runs.id))
    .where(
      and(
        eq(runs.clientId, clientId),
        eq(runs.adaptersMode, await effectiveAdaptersMode(db, clientId)),
        eq(mentions.isClient, true),
        gte(responses.createdAt, from),
        lte(responses.createdAt, to),
      ),
    );

  return rows.length;
}

export async function createExperiment(
  db: Database,
  values: NewExperiment,
): Promise<Experiment> {
  const rows = await db.insert(experiments).values(values).returning();
  const created = rows[0];
  if (!created) {
    throw new Error("Failed to create experiment");
  }
  return created;
}

export async function getExperimentByAction(
  db: Database,
  actionId: string,
): Promise<Experiment | undefined> {
  const rows = await db
    .select()
    .from(experiments)
    .where(eq(experiments.actionId, actionId))
    .limit(1);
  return rows[0];
}

export async function getExperimentById(
  db: Database,
  experimentId: string,
): Promise<Experiment | undefined> {
  const rows = await db.select().from(experiments).where(eq(experiments.id, experimentId)).limit(1);
  return rows[0];
}

export async function listExperiments(db: Database, clientId: string): Promise<Experiment[]> {
  return db
    .select()
    .from(experiments)
    .where(eq(experiments.clientId, clientId))
    .orderBy(desc(experiments.createdAt));
}

export async function addExperimentEvent(
  db: Database,
  values: NewExperimentEvent,
): Promise<void> {
  await db.insert(experimentEvents).values(values);
}

export async function listExperimentEvents(
  db: Database,
  experimentId: string,
): Promise<ExperimentEvent[]> {
  return db
    .select()
    .from(experimentEvents)
    .where(eq(experimentEvents.experimentId, experimentId))
    .orderBy(experimentEvents.occurredAt);
}

/** Все срезы клиента: вход для расчёта baseline (контракт C5). */
/**
 * Датированные факты цитирования: то же, что listCitationFacts, но с датой
 * ответа и фильтром по домену. Нужны, чтобы отличить «было до работы» от
 * «появилось после» — без даты этот вопрос не задать.
 */
export async function listDatedCitationFacts(
  db: Database,
  clientId: string,
  sourceDomain?: string,
) {
  const conditions = [
    eq(runs.clientId, clientId),
    eq(runs.adaptersMode, await effectiveAdaptersMode(db, clientId)),
  ];
  if (sourceDomain) {
    conditions.push(eq(citations.domain, sourceDomain));
  }

  return db
    .select({
      responseId: responses.id,
      domain: citations.domain,
      observedAt: responses.createdAt,
      isClient: mentions.isClient,
    })
    .from(citations)
    .innerJoin(responses, eq(citations.responseId, responses.id))
    .innerJoin(runs, eq(responses.runId, runs.id))
    .leftJoin(mentions, eq(mentions.responseId, responses.id))
    .where(and(...conditions));
}

/**
 * Удаляет срезы клиента, которых нет в свежем пересчёте.
 *
 * Без этого в таблице остаются осиротевшие ячейки: например, срезы по Gemini
 * от прогона на фикстурах, который перестал учитываться после первого живого
 * измерения. Свёртка при этом верна, а строки по платформам продолжают
 * утверждать, что платформа измерялась. Отчёт, собранный по ним, соврёт.
 */
export async function deleteSnapshotsNotIn(
  db: Database,
  clientId: string,
  keep: { clusterId: string | null; platform: string | null; periodStart: Date }[],
): Promise<number> {
  const existing = await db
    .select()
    .from(visibilitySnapshots)
    .where(eq(visibilitySnapshots.clientId, clientId));

  const keys = new Set(
    keep.map((cell) => `${cell.clusterId ?? ""}|${cell.platform ?? ""}|${cell.periodStart.getTime()}`),
  );

  const stale = existing.filter(
    (row) =>
      !keys.has(`${row.clusterId ?? ""}|${row.platform ?? ""}|${row.periodStart.getTime()}`),
  );

  for (const row of stale) {
    await db.delete(visibilitySnapshots).where(eq(visibilitySnapshots.id, row.id));
  }

  return stale.length;
}

export async function listAllSnapshots(
  db: Database,
  clientId: string,
): Promise<VisibilitySnapshotRow[]> {
  return db
    .select()
    .from(visibilitySnapshots)
    .where(eq(visibilitySnapshots.clientId, clientId))
    .orderBy(visibilitySnapshots.periodStart);
}

export async function listActions(db: Database, clientId: string): Promise<Action[]> {
  return db
    .select()
    .from(actions)
    .where(eq(actions.clientId, clientId))
    .orderBy(desc(actions.createdAt));
}

export async function getActionById(db: Database, actionId: string): Promise<Action | undefined> {
  const rows = await db.select().from(actions).where(eq(actions.id, actionId)).limit(1);
  return rows[0];
}

export async function createAction(db: Database, values: NewAction): Promise<Action> {
  const rows = await db.insert(actions).values(values).returning();
  const created = rows[0];
  if (!created) {
    throw new Error("Failed to create action");
  }
  return created;
}

export async function updateAction(
  db: Database,
  actionId: string,
  patch: Partial<
    Pick<
      Action,
      | "title"
      | "reason"
      | "actionType"
      | "status"
      | "estimatedImpact"
      | "effort"
      | "ownerUserId"
      | "completedAt"
      | "affectedClusterIds"
    >
  >,
): Promise<Action | undefined> {
  const rows = await db.update(actions).set(patch).where(eq(actions.id, actionId)).returning();
  return rows[0];
}

/**
 * Проставляет дату завершения напрямую. Нужна там, где дату задаёт не «сейчас»:
 * действие могли выполнить до того, как его завели в системе.
 */
export async function setActionCompletedAt(
  db: Database,
  actionId: string,
  completedAt: Date,
): Promise<void> {
  await db.update(actions).set({ completedAt }).where(eq(actions.id, actionId));
}

export async function deleteAction(db: Database, actionId: string): Promise<void> {
  await db.delete(actions).where(eq(actions.id, actionId));
}

/** Действие с таким же правилом и источником уже заведено — не плодим дубли. */
export async function findExistingAction(
  db: Database,
  clientId: string,
  originRule: string,
  sourceDomain: string | null,
): Promise<Action | undefined> {
  const rows = await db
    .select()
    .from(actions)
    .where(
      and(
        eq(actions.clientId, clientId),
        eq(actions.originRule, originRule),
        sourceDomain === null
          ? isNull(actions.sourceDomain)
          : eq(actions.sourceDomain, sourceDomain),
      ),
    )
    .limit(1);
  return rows[0];
}

export async function listPromptClusters(
  db: Database,
  clientId: string,
): Promise<PromptCluster[]> {
  return db.select().from(promptClusters).where(eq(promptClusters.clientId, clientId));
}

export async function getPromptClusterById(
  db: Database,
  clusterId: string,
): Promise<PromptCluster | undefined> {
  const rows = await db
    .select()
    .from(promptClusters)
    .where(eq(promptClusters.id, clusterId))
    .limit(1);
  return rows[0];
}

export async function createPromptCluster(
  db: Database,
  values: NewPromptCluster,
): Promise<PromptCluster> {
  const rows = await db.insert(promptClusters).values(values).returning();
  const created = rows[0];
  if (!created) {
    throw new Error("Failed to create prompt cluster");
  }
  return created;
}

export async function updatePromptCluster(
  db: Database,
  clusterId: string,
  patch: Partial<Pick<PromptCluster, "name" | "intent">>,
): Promise<PromptCluster | undefined> {
  const rows = await db
    .update(promptClusters)
    .set(patch)
    .where(eq(promptClusters.id, clusterId))
    .returning();
  return rows[0];
}

export async function deletePromptCluster(db: Database, clusterId: string): Promise<void> {
  await db.delete(promptClusters).where(eq(promptClusters.id, clusterId));
}

export async function listPromptsByClient(db: Database, clientId: string): Promise<Prompt[]> {
  return db
    .select({
      id: prompts.id,
      clusterId: prompts.clusterId,
      text: prompts.text,
      isControl: prompts.isControl,
      language: prompts.language,
      geo: prompts.geo,
      active: prompts.active,
      createdAt: prompts.createdAt,
    })
    .from(prompts)
    .innerJoin(promptClusters, eq(prompts.clusterId, promptClusters.id))
    .where(eq(promptClusters.clientId, clientId));
}

export async function getPromptById(db: Database, promptId: string): Promise<Prompt | undefined> {
  const rows = await db.select().from(prompts).where(eq(prompts.id, promptId)).limit(1);
  return rows[0];
}

export async function createPrompt(db: Database, values: NewPrompt): Promise<Prompt> {
  const rows = await db.insert(prompts).values(values).returning();
  const created = rows[0];
  if (!created) {
    throw new Error("Failed to create prompt");
  }
  return created;
}

export async function updatePrompt(
  db: Database,
  promptId: string,
  patch: Partial<Pick<Prompt, "text" | "isControl" | "active">>,
): Promise<Prompt | undefined> {
  const rows = await db.update(prompts).set(patch).where(eq(prompts.id, promptId)).returning();
  return rows[0];
}

export async function deletePrompt(db: Database, promptId: string): Promise<void> {
  await db.delete(prompts).where(eq(prompts.id, promptId));
}

export async function listUsersByAgency(db: Database, agencyId: string): Promise<User[]> {
  return db.select().from(users).where(eq(users.agencyId, agencyId));
}

/**
 * Заводит пользователя напрямую. Обычный путь — регистрация через Better
 * Auth; это нужно сидам и тестам, которым учётные данные не требуются.
 */
export async function createUser(
  db: Database,
  values: { agencyId: string; email: string; name: string; role?: User["role"] },
): Promise<User> {
  const rows = await db.insert(users).values(values).returning();
  const created = rows[0];
  if (!created) {
    throw new Error("Failed to create user");
  }
  return created;
}

export async function getUserByEmail(db: Database, email: string): Promise<User | undefined> {
  const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
  return rows[0];
}

export async function createInvitation(
  db: Database,
  values: { agencyId: string; email: string; role: string; token: string; expiresAt: Date },
) {
  const rows = await db.insert(invitations).values(values).returning();
  const created = rows[0];
  if (!created) {
    throw new Error("Failed to create invitation");
  }
  return created;
}

export async function getInvitationByToken(db: Database, token: string) {
  const rows = await db.select().from(invitations).where(eq(invitations.token, token)).limit(1);
  return rows[0];
}

/** Действующее приглашение для адреса: не принято и не истекло. */
export async function getPendingInvitationByEmail(db: Database, email: string) {
  const rows = await db
    .select()
    .from(invitations)
    .where(and(eq(invitations.email, email), eq(invitations.accepted, false)))
    .limit(1);

  const invitation = rows[0];
  if (!invitation || invitation.expiresAt.getTime() < Date.now()) {
    return undefined;
  }
  return invitation;
}

export async function listInvitationsByAgency(db: Database, agencyId: string) {
  return db
    .select()
    .from(invitations)
    .where(and(eq(invitations.agencyId, agencyId), eq(invitations.accepted, false)));
}

export async function markInvitationAccepted(db: Database, token: string): Promise<void> {
  await db.update(invitations).set({ accepted: true }).where(eq(invitations.token, token));
}

/* ------------------------------------------------------------------ */
/* Возможности                                                         */
/* ------------------------------------------------------------------ */

export interface NewOpportunityInput {
  dedupeKey: string;
  kind: Opportunity["kind"];
  title: string;
  reason: string;
  score: number;
  scoreVersion: number;
  scoreBreakdown: Record<string, unknown>;
  evidenceLevel: "low" | "medium" | "high";
  evidence: Record<string, unknown>;
  recommendedActions: Record<string, unknown>[];
  affectedPromptIds: string[];
  affectedClusterIds: string[];
  competitorNames: string[];
  sourceDomain: string | null;
  sampleCount: number;
}

export interface UpsertOpportunitiesResult {
  inserted: number;
  updated: number;
}

/**
 * Записывает результат пересчёта, не трогая решений человека.
 *
 * Список полей в `set` — несущая конструкция всей функции. В нём только
 * машинные колонки. Человеческих там нет и быть не должно: status,
 * dismissedReason, snoozedUntil, decisionScore, decidedByUserId, decidedAt,
 * firstDetectedAt. Если они туда попадут, ночной прогон вернёт всё, что
 * агентство вчера отклонило, — и функция станет вреднее своего отсутствия.
 *
 * Ровно два исключения, оба записаны в SQL явно:
 *  • отложенное возвращается, когда срок вышел;
 *  • отклонённое возвращается, когда выросло на `reopenDeltaPoints` —
 *    отклонение было суждением о фактах на тот момент, а не навсегда.
 */
export async function upsertOpportunities(
  db: Database,
  params: {
    clientId: string;
    generationId: string;
    windowStart: Date;
    windowEnd: Date;
    rows: NewOpportunityInput[];
    reopenDeltaPoints: number;
    now?: Date;
  },
): Promise<UpsertOpportunitiesResult> {
  const now = params.now ?? new Date();
  if (params.rows.length === 0) return { inserted: 0, updated: 0 };

  const keys = params.rows.map((row) => row.dedupeKey);
  const existing = await db
    .select({ dedupeKey: opportunities.dedupeKey })
    .from(opportunities)
    .where(and(eq(opportunities.clientId, params.clientId), inArray(opportunities.dedupeKey, keys)));
  const known = new Set(existing.map((row) => row.dedupeKey));

  await db
    .insert(opportunities)
    .values(
      params.rows.map((row) => ({
        clientId: params.clientId,
        dedupeKey: row.dedupeKey,
        kind: row.kind,
        title: row.title,
        reason: row.reason,
        score: row.score,
        scoreVersion: row.scoreVersion,
        scoreBreakdown: row.scoreBreakdown,
        evidenceLevel: row.evidenceLevel,
        evidence: row.evidence,
        recommendedActions: row.recommendedActions,
        affectedPromptIds: row.affectedPromptIds,
        affectedClusterIds: row.affectedClusterIds,
        competitorNames: row.competitorNames,
        sourceDomain: row.sourceDomain,
        sampleCount: row.sampleCount,
        windowStart: params.windowStart,
        windowEnd: params.windowEnd,
        generationId: params.generationId,
        firstDetectedAt: now,
        lastDetectedAt: now,
        createdAt: now,
        updatedAt: now,
      })),
    )
    .onConflictDoUpdate({
      target: [opportunities.clientId, opportunities.dedupeKey],
      set: {
        kind: sql`excluded.kind`,
        title: sql`excluded.title`,
        reason: sql`excluded.reason`,
        score: sql`excluded.score`,
        scoreVersion: sql`excluded.score_version`,
        scoreBreakdown: sql`excluded.score_breakdown`,
        evidenceLevel: sql`excluded.evidence_level`,
        evidence: sql`excluded.evidence`,
        recommendedActions: sql`excluded.recommended_actions`,
        affectedPromptIds: sql`excluded.affected_prompt_ids`,
        affectedClusterIds: sql`excluded.affected_cluster_ids`,
        competitorNames: sql`excluded.competitor_names`,
        sourceDomain: sql`excluded.source_domain`,
        sampleCount: sql`excluded.sample_count`,
        windowStart: sql`excluded.window_start`,
        windowEnd: sql`excluded.window_end`,
        lastDetectedAt: sql`excluded.last_detected_at`,
        generationId: sql`excluded.generation_id`,
        resolvedAt: sql`null`,
        updatedAt: sql`excluded.updated_at`,
        status: sql`case
          when ${opportunities.status} = 'snoozed'
               and ${opportunities.snoozedUntil} is not null
               and ${opportunities.snoozedUntil} <= excluded.last_detected_at then 'open'
          when ${opportunities.status} = 'dismissed'
               and excluded.score >= coalesce(${opportunities.decisionScore}, 100) + ${params.reopenDeltaPoints} then 'open'
          else ${opportunities.status}
        end`,
        decisionScore: sql`case
          when ${opportunities.status} = 'dismissed'
               and excluded.score >= coalesce(${opportunities.decisionScore}, 100) + ${params.reopenDeltaPoints} then null
          else ${opportunities.decisionScore}
        end`,
      },
    });

  const inserted = params.rows.filter((row) => !known.has(row.dedupeKey)).length;
  return { inserted, updated: params.rows.length - inserted };
}

/**
 * Закрывает то, что в этом пересчёте не обнаружилось.
 *
 * Строки не удаляются: закрытая возможность рядом с выполненным действием —
 * это и есть запись о том, что изменилось, и она нужна отчёту. Сравнение идёт
 * по партии пересчёта, а не по списку ключей: так корректно даже если детектор
 * упал на середине — строки просто останутся с прошлой партией.
 */
export async function resolveOpportunitiesNotIn(
  db: Database,
  clientId: string,
  generationId: string,
  now: Date = new Date(),
): Promise<number> {
  const rows = await db
    .update(opportunities)
    .set({ resolvedAt: now, updatedAt: now })
    .where(
      and(
        eq(opportunities.clientId, clientId),
        sql`${opportunities.generationId} <> ${generationId}`,
        isNull(opportunities.resolvedAt),
      ),
    )
    .returning({ id: opportunities.id });

  return rows.length;
}

export async function listOpportunities(
  db: Database,
  clientId: string,
  options: { includeResolved?: boolean } = {},
): Promise<Opportunity[]> {
  const conditions = [eq(opportunities.clientId, clientId)];
  if (!options.includeResolved) {
    conditions.push(isNull(opportunities.resolvedAt));
  }

  return db
    .select()
    .from(opportunities)
    .where(and(...conditions))
    .orderBy(desc(opportunities.score), opportunities.dedupeKey);
}

export async function getOpportunityById(
  db: Database,
  id: string,
): Promise<Opportunity | undefined> {
  const rows = await db.select().from(opportunities).where(eq(opportunities.id, id)).limit(1);
  return rows[0];
}

/** Клиент возможности — для tenancy guard на стороне API. */
export async function getClientForOpportunity(
  db: Database,
  opportunityId: string,
): Promise<Client | undefined> {
  const rows = await db
    .select({ client: clients })
    .from(opportunities)
    .innerJoin(clients, eq(clients.id, opportunities.clientId))
    .where(eq(opportunities.id, opportunityId))
    .limit(1);

  return rows[0]?.client;
}

/** Решение человека: оценка на момент решения записывается вместе с ним. */
export async function setOpportunityDecision(
  db: Database,
  id: string,
  decision: {
    status: Opportunity["status"];
    dismissedReason?: string | null;
    snoozedUntil?: Date | null;
    decidedByUserId?: string | null;
    decisionScore: number | null;
    now?: Date;
  },
): Promise<Opportunity | undefined> {
  const now = decision.now ?? new Date();
  const rows = await db
    .update(opportunities)
    .set({
      status: decision.status,
      dismissedReason: decision.dismissedReason ?? null,
      snoozedUntil: decision.snoozedUntil ?? null,
      decidedByUserId: decision.decidedByUserId ?? null,
      decisionScore: decision.decisionScore,
      decidedAt: now,
      updatedAt: now,
    })
    .where(eq(opportunities.id, id))
    .returning();

  return rows[0];
}

/** Когда по клиенту последний раз считались возможности. */
export async function lastOpportunityGenerationAt(
  db: Database,
  clientId: string,
): Promise<Date | null> {
  const rows = await db
    // Агрегат идёт мимо разбора типов drizzle и приходит строкой — приводим
    // здесь, иначе вызывающий код получит строку под видом даты.
    .select({ at: sql<string | null>`max(${opportunities.lastDetectedAt})` })
    .from(opportunities)
    .where(eq(opportunities.clientId, clientId));

  const at = rows[0]?.at;
  return at ? new Date(at) : null;
}

export interface OpportunityCounts {
  clientId: string;
  open: number;
  highPriority: number;
  newRecently: number;
  topScore: number | null;
}

/**
 * Счётчики по клиентам одним запросом — для портфеля агентства.
 * Порог «высокого» приоритета приходит снаружи: это продуктовое решение, и
 * единственное его определение живёт рядом с формулой оценки.
 */
export async function listOpportunityCounts(
  db: Database,
  clientIds: string[],
  options: { highPriorityScore: number; since: Date },
): Promise<OpportunityCounts[]> {
  if (clientIds.length === 0) return [];

  return db
    .select({
      clientId: opportunities.clientId,
      open: sql<number>`count(*)::int`,
      highPriority: sql<number>`count(*) filter (where ${opportunities.score} >= ${options.highPriorityScore})::int`,
      // Дата уходит строкой с явным приведением: внутри сырого выражения
      // postgres-js не умеет сериализовать Date и падает на первом же запросе.
      newRecently: sql<number>`count(*) filter (where ${opportunities.firstDetectedAt} >= ${options.since.toISOString()}::timestamptz)::int`,
      topScore: sql<number | null>`max(${opportunities.score})`,
    })
    .from(opportunities)
    .where(
      and(
        inArray(opportunities.clientId, clientIds),
        isNull(opportunities.resolvedAt),
        eq(opportunities.status, "open"),
      ),
    )
    .groupBy(opportunities.clientId);
}

export interface OpportunityEvidenceRows {
  prompts: { id: string; text: string; clusterId: string; clusterName: string }[];
  responses: {
    responseId: string;
    promptId: string;
    platform: string;
    createdAt: Date;
    clientMentioned: boolean;
    competitorsMentioned: string[];
    citedDomains: string[];
  }[];
  totalResponsesInWindow: number;
}

/**
 * Доказательство под возможностью: те самые ответы, по которым она посчитана.
 *
 * Окно берётся из самой строки, а не «последние 28 дней»: окно скользящее, и
 * выборка по сегодняшнему дала бы ответ из других данных, чем те, что дали
 * оценку. Фильтр по режиму адаптеров обязателен — показать здесь фикстуры
 * вместо живых ответов было бы худшим местом для такой ошибки.
 */
export async function listOpportunityEvidence(
  db: Database,
  opportunity: Opportunity,
  limit = 20,
): Promise<OpportunityEvidenceRows> {
  const promptIds = opportunity.affectedPromptIds;
  if (promptIds.length === 0) {
    return { prompts: [], responses: [], totalResponsesInWindow: 0 };
  }

  const promptRows = await db
    .select({
      id: prompts.id,
      text: prompts.text,
      clusterId: prompts.clusterId,
      clusterName: promptClusters.name,
    })
    .from(prompts)
    .innerJoin(promptClusters, eq(promptClusters.id, prompts.clusterId))
    .where(inArray(prompts.id, promptIds));

  const mode = await effectiveAdaptersMode(db, opportunity.clientId);
  const conditions = [
    eq(runs.clientId, opportunity.clientId),
    eq(runs.adaptersMode, mode),
    inArray(responses.promptId, promptIds),
    gte(responses.createdAt, opportunity.windowStart),
    lte(responses.createdAt, opportunity.windowEnd),
  ];

  const totals = await db
    .select({ total: sql<number>`count(*)::int` })
    .from(responses)
    .innerJoin(runs, eq(responses.runId, runs.id))
    .where(and(...conditions));

  const responseRows = await db
    .select({
      responseId: responses.id,
      promptId: responses.promptId,
      platform: responses.platform,
      createdAt: responses.createdAt,
    })
    .from(responses)
    .innerJoin(runs, eq(responses.runId, runs.id))
    .where(and(...conditions))
    .orderBy(desc(responses.createdAt))
    .limit(limit);

  const responseIds = responseRows.map((row) => row.responseId);
  if (responseIds.length === 0) {
    return { prompts: promptRows, responses: [], totalResponsesInWindow: totals[0]?.total ?? 0 };
  }

  const [mentionRows, citationRows] = await Promise.all([
    db
      .select({
        responseId: mentions.responseId,
        entityName: mentions.entityName,
        isClient: mentions.isClient,
        isCompetitor: mentions.isCompetitor,
      })
      .from(mentions)
      .where(inArray(mentions.responseId, responseIds)),
    db
      .select({ responseId: citations.responseId, domain: citations.domain })
      .from(citations)
      .where(inArray(citations.responseId, responseIds)),
  ]);

  const byResponse = new Map(
    responseRows.map((row) => [
      row.responseId,
      {
        ...row,
        clientMentioned: false,
        competitorsMentioned: [] as string[],
        citedDomains: [] as string[],
      },
    ]),
  );

  for (const mention of mentionRows) {
    const entry = byResponse.get(mention.responseId);
    if (!entry) continue;
    if (mention.isClient) entry.clientMentioned = true;
    if (mention.isCompetitor && mention.entityName) {
      entry.competitorsMentioned.push(mention.entityName);
    }
  }

  for (const citation of citationRows) {
    const entry = byResponse.get(citation.responseId);
    if (!entry || entry.citedDomains.includes(citation.domain)) continue;
    entry.citedDomains.push(citation.domain);
  }

  return {
    prompts: promptRows,
    responses: [...byResponse.values()],
    totalResponsesInWindow: totals[0]?.total ?? 0,
  };
}

/** Действия, выросшие из возможности. */
export async function listActionsForOpportunity(
  db: Database,
  opportunityId: string,
): Promise<Action[]> {
  return db.select().from(actions).where(eq(actions.originOpportunityId, opportunityId));
}

/**
 * Переводит эксперимент в другое состояние.
 *
 * `ready` ставит конвейер, когда после действия набралось достаточно ответов,
 * чтобы вообще что-то оценивать. Раньше статус не менялся никогда, и «готовые
 * к оценке» на экране агентства были бы обещанием, которого никто не держит.
 */
export async function setExperimentStatus(
  db: Database,
  experimentId: string,
  status: Experiment["status"],
): Promise<void> {
  await db.update(experiments).set({ status }).where(eq(experiments.id, experimentId));
}

export interface AgencyRunStats {
  /** Расписаний, которые сработают до конца суток. */
  scheduledToday: number;
  /** Прогонов, завершившихся неудачно за последнюю неделю. */
  failedLastWeek: number;
}

/**
 * Состояние прогонов по агентству целиком.
 *
 * Отдельным запросом, а не перебором клиентов: главный экран открывают в
 * каждый заход, и десяток запросов ради двух чисел — это десяток запросов.
 * Неудачный прогон здесь важнее удачного: он означает, что цифры клиента
 * сегодня не обновились, а экран об этом молчит.
 */
export async function agencyRunStats(
  db: Database,
  agencyId: string,
  now: Date = new Date(),
): Promise<AgencyRunStats> {
  const endOfDay = new Date(now);
  endOfDay.setUTCHours(23, 59, 59, 999);
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000);

  const [scheduled, failed] = await Promise.all([
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(runSchedules)
      .innerJoin(clients, eq(clients.id, runSchedules.clientId))
      .where(
        and(
          eq(clients.agencyId, agencyId),
          eq(runSchedules.active, true),
          lte(runSchedules.nextRunAt, endOfDay),
        ),
      ),
    db
      .select({ count: sql<number>`count(*)::int` })
      .from(runs)
      .innerJoin(clients, eq(clients.id, runs.clientId))
      .where(
        and(
          eq(clients.agencyId, agencyId),
          eq(runs.status, "failed"),
          gte(runs.startedAt, weekAgo),
        ),
      ),
  ]);

  return {
    scheduledToday: scheduled[0]?.count ?? 0,
    failedLastWeek: failed[0]?.count ?? 0,
  };
}

export interface AgencyReportRow {
  id: string;
  clientId: string;
  clientName: string;
  periodStart: Date;
  periodEnd: Date;
  status: Report["status"];
  createdAt: Date;
  /** Ссылка выдана, но клиент ещё не согласовал. */
  awaitingApproval: boolean;
}

/**
 * Все отчёты агентства одним списком.
 *
 * Отчёты живут у клиента, но вопрос «кому пора отправлять и кто ещё не
 * согласовал» — про всё агентство сразу, и обходить ради него клиентов по
 * одному значит платить запросом за каждого.
 */
export async function listAgencyReports(
  db: Database,
  agencyId: string,
): Promise<AgencyReportRow[]> {
  const rows = await db
    .select({
      id: reports.id,
      clientId: reports.clientId,
      clientName: clients.name,
      periodStart: reports.periodStart,
      periodEnd: reports.periodEnd,
      status: reports.status,
      createdAt: reports.createdAt,
      shareId: reportShares.id,
      approvedAt: reportShares.approvedAt,
    })
    .from(reports)
    .innerJoin(clients, eq(clients.id, reports.clientId))
    .leftJoin(reportShares, eq(reportShares.reportId, reports.id))
    .where(eq(clients.agencyId, agencyId))
    .orderBy(desc(reports.createdAt));

  return rows.map((row) => ({
    id: row.id,
    clientId: row.clientId,
    clientName: row.clientName,
    periodStart: row.periodStart,
    periodEnd: row.periodEnd,
    status: row.status,
    createdAt: row.createdAt,
    awaitingApproval: row.shareId !== null && row.approvedAt === null,
  }));
}

/**
 * Занимает событие платёжного провайдера под обработку.
 *
 * Защита от повторной доставки — первичный ключ: вторая вставка того же
 * идентификатора ничего не вставляет, и вызывающий понимает, что событие уже
 * применено. Занимать нужно до записи чего бы то ни было, иначе между
 * проверкой и записью проскочит повтор.
 */
export async function claimPaymentEvent(
  db: Database,
  eventId: string,
  occurredAt: Date,
  provider = "stripe",
): Promise<boolean> {
  const rows = await db
    .insert(paymentEvents)
    .values({ eventId, provider, occurredAt })
    .onConflictDoNothing({ target: paymentEvents.eventId })
    .returning({ eventId: paymentEvents.eventId });
  return rows.length > 0;
}

/**
 * Освобождает событие, если применить его не удалось.
 *
 * Без этого сбой базы превращался бы в потерянное событие: повтор от
 * провайдера пришёл бы, увидел занятый идентификатор и не сделал ничего.
 */
export async function releasePaymentEvent(db: Database, eventId: string): Promise<void> {
  await db.delete(paymentEvents).where(eq(paymentEvents.eventId, eventId));
}

/**
 * Убирает старые записи журнала.
 *
 * Возраст считается по времени события у провайдера: именно по нему он
 * решает, повторять доставку или нет (Stripe — до трёх суток). Наше время
 * обработки для этого не годится: запись, сделанная сегодня по вчерашнему
 * событию, всё равно уже не повторится.
 */
export async function prunePaymentEvents(db: Database, before: Date): Promise<number> {
  const rows = await db
    .delete(paymentEvents)
    .where(sql`${paymentEvents.occurredAt} < ${before.toISOString()}::timestamptz`)
    .returning({ eventId: paymentEvents.eventId });
  return rows.length;
}
