import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { clients } from "./tenancy";

/** Интент кластера определяет, какой формат ответа вообще может процитировать модель. */
export const promptIntentEnum = pgEnum("prompt_intent", [
  "learning",
  "comparison",
  "purchase",
  "other",
]);

export const platformEnum = pgEnum("platform", ["chatgpt", "perplexity", "gemini", "claude", "grok"]);
/**
 * Частота прогонов.
 *
 * По умолчанию раз в две недели: ассистенты переобходят сайты неделями, а
 * заметный сдвиг занимает 60–90 дней — измерять чаще, чем меняется предмет
 * измерения, значит платить вдвое за ту же кривую. Недельная частота нужна
 * там, где идёт эксперимент и важно знать дату сдвига точнее.
 */
export const cadenceEnum = pgEnum("cadence", ["daily", "weekly", "biweekly"]);
export const runStatusEnum = pgEnum("run_status", ["pending", "running", "done", "failed"]);

/** Совпадает с ADAPTERS_MODE: чем именно получены ответы прогона. */
export const adaptersModeEnum = pgEnum("adapters_mode", ["mock", "live"]);
export const runTriggerEnum = pgEnum("run_trigger", ["scheduled", "manual"]);
export const sentimentEnum = pgEnum("sentiment", ["positive", "neutral", "negative"]);
export const entityTypeEnum = pgEnum("entity_type", ["client", "competitor", "other"]);

export const promptClusters = pgTable(
  "prompt_clusters",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    intent: promptIntentEnum("intent").notNull().default("other"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("prompt_clusters_client_id_idx").on(table.clientId)],
);

export const prompts = pgTable(
  "prompts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clusterId: uuid("cluster_id")
      .notNull()
      .references(() => promptClusters.id, { onDelete: "cascade" }),
    text: text("text").notNull(),
    /** Контрольные промпты не затрагиваются действиями — база сравнения для экспериментов (T43). */
    isControl: boolean("is_control").notNull().default(false),
    language: text("language").notNull().default("en"),
    geo: text("geo").notNull().default("us"),
    active: boolean("active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("prompts_cluster_id_idx").on(table.clusterId)],
);

export const runSchedules = pgTable(
  "run_schedules",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    cadence: cadenceEnum("cadence").notNull().default("biweekly"),
    platforms: platformEnum("platforms").array().notNull().default(["chatgpt"]),
    /**
     * Повторные прогоны одного промпта: ответы моделей стохастичны,
     * visibility считается по доле, а не по одному ответу (контракт C3).
     */
    samplesPerPrompt: integer("samples_per_prompt").notNull().default(3),
    nextRunAt: timestamp("next_run_at", { withTimezone: true }),
    active: boolean("active").notNull().default(true),
    /**
     * Почему последний созревший замер не начался — человеческой фразой.
     *
     * Без этого пропуск (лимит израсходован, частота не по тарифу, нет
     * вопросов) жил только в логе воркера, а экран показывал прошедшую дату
     * «Next run». Пусто — последний срок отработал.
     */
    skipReason: text("skip_reason"),
    skippedAt: timestamp("skipped_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("run_schedules_next_run_at_idx").on(table.nextRunAt),
    /**
     * Одно расписание на клиента.
     *
     * Без этого ограничения гонка между двумя сохранениями оставляла второе
     * расписание, и каждый тик заводил по прогону на каждое — двойной расход
     * на живых адаптерах и удвоенные цифры в измерениях.
     */
    uniqueIndex("run_schedules_client_idx").on(table.clientId),
  ],
);

export const runs = pgTable(
  "runs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    scheduleId: uuid("schedule_id").references(() => runSchedules.id, { onDelete: "set null" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    status: runStatusEnum("status").notNull().default("pending"),
    trigger: runTriggerEnum("trigger").notNull().default("scheduled"),
    /**
     * Чем получены ответы этого прогона. Без этого признака фикстуры и живые
     * измерения складываются в одну цифру: достаточно один раз нажать «Run»
     * на стенде с ADAPTERS_MODE=mock, и в графике клиента появятся ответы про
     * чужую выдуманную компанию. Метрика, которая так делает, не измерение.
     */
    adaptersMode: adaptersModeEnum("adapters_mode").notNull().default("mock"),
    /**
     * Сколько ответов прогону разрешено при старте.
     *
     * Проверка лимита идёт в вебе, а задачи ставит воркер секундами позже,
     * перечитывая вопросы и расписание. Без записанного размера между ними
     * можно было добавить тысячи вопросов, и воркер тратил бы на все. Воркер
     * больше одобренного не ставит; сумма по прогонам — это ещё и расход,
     * обещанный, но не дописанный в счётчик (идущие и упавшие прогоны).
     * Пусто у прогонов, созданных до появления поля.
     */
    plannedChecks: integer("planned_checks"),
    /**
     * Пояснение к итогу прогона для экрана: почему он упал или чего в нём
     * не хватает («140 of 144 answers came back»). Пусто — прогон полный.
     */
    note: text("note"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
  },
  (table) => [index("runs_client_id_idx").on(table.clientId)],
);

export const responses = pgTable(
  "responses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    runId: uuid("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    promptId: uuid("prompt_id")
      .notNull()
      .references(() => prompts.id, { onDelete: "cascade" }),
    platform: platformEnum("platform").notNull(),
    modelVersion: text("model_version").notNull(),
    /** Номер повтора внутри прогона: 0..samplesPerPrompt-1. */
    sampleIndex: integer("sample_index").notNull().default(0),
    rawText: text("raw_text").notNull(),
    /** Сырой ответ дублируется в storage — нужен для переобработки парсером (инвариант 6). */
    rawStorageKey: text("raw_storage_key"),
    latencyMs: integer("latency_ms"),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6 }).notNull().default("0"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("responses_run_id_idx").on(table.runId),
    index("responses_prompt_id_idx").on(table.promptId),
    // Повтор одного и того же сэмпла в рамках прогона — всегда ошибка оркестрации.
    uniqueIndex("responses_unique_sample_idx").on(
      table.runId,
      table.promptId,
      table.platform,
      table.sampleIndex,
    ),
  ],
);

export const mentions = pgTable(
  "mentions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    responseId: uuid("response_id")
      .notNull()
      .references(() => responses.id, { onDelete: "cascade" }),
    entityType: entityTypeEnum("entity_type").notNull().default("other"),
    entityName: text("entity_name").notNull(),
    /** 1-based порядок появления в ответе. */
    position: integer("position").notNull(),
    sentiment: sentimentEnum("sentiment").notNull().default("neutral"),
    isClient: boolean("is_client").notNull().default(false),
    isCompetitor: boolean("is_competitor").notNull().default(false),
  },
  (table) => [index("mentions_response_id_idx").on(table.responseId)],
);

export const citations = pgTable(
  "citations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    responseId: uuid("response_id")
      .notNull()
      .references(() => responses.id, { onDelete: "cascade" }),
    url: text("url").notNull(),
    domain: text("domain").notNull(),
    title: text("title"),
    position: integer("position").notNull().default(1),
  },
  (table) => [
    index("citations_response_id_idx").on(table.responseId),
    index("citations_domain_idx").on(table.domain),
  ],
);

/**
 * Агрегаты visibility (контракт C3). Единственный источник цифр для UI и отчётов:
 * показывать долю по одному ответу запрещено инвариантом 6.
 */
export const visibilitySnapshots = pgTable(
  "visibility_snapshots",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    /** null — свёртка по всем кластерам. */
    clusterId: uuid("cluster_id").references(() => promptClusters.id, { onDelete: "cascade" }),
    /** null — свёртка по всем платформам. */
    platform: platformEnum("platform"),
    periodStart: timestamp("period_start", { withTimezone: true }).notNull(),
    periodEnd: timestamp("period_end", { withTimezone: true }).notNull(),
    clientVisibilityPct: numeric("client_visibility_pct", { precision: 5, scale: 1 }).notNull(),
    competitorVisibility: jsonb("competitor_visibility")
      .$type<Record<string, number>>()
      .notNull()
      .default({}),
    sampleCount: integer("sample_count").notNull(),
    /** false — сэмплов меньше порога, цифру нельзя показывать как измерение. */
    sufficient: boolean("sufficient").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("visibility_snapshots_client_idx").on(table.clientId),
    /**
     * Индекс для поиска ячейки, НЕ уникальный.
     *
     * Уникальность здесь потребовала бы `NULLS NOT DISTINCT` (cluster_id и platform
     * содержат null у свёрток, а Postgres по умолчанию считает NULL-ы различными),
     * а drizzle-kit этой версии такой индекс выразить не умеет. Поэтому идемпотентность
     * пересчёта обеспечивается явным upsert'ом в коде (`upsertVisibilitySnapshot`),
     * а не ограничением БД. Агрегация по клиенту идёт одним заданием, гонки нет.
     */
    index("visibility_snapshots_cell_idx").on(
      table.clientId,
      table.clusterId,
      table.platform,
      table.periodStart,
    ),
  ],
);

export type VisibilitySnapshotRow = typeof visibilitySnapshots.$inferSelect;
export type NewVisibilitySnapshotRow = typeof visibilitySnapshots.$inferInsert;

export const promptClustersRelations = relations(promptClusters, ({ one, many }) => ({
  client: one(clients, { fields: [promptClusters.clientId], references: [clients.id] }),
  prompts: many(prompts),
}));

export const promptsRelations = relations(prompts, ({ one }) => ({
  cluster: one(promptClusters, {
    fields: [prompts.clusterId],
    references: [promptClusters.id],
  }),
}));

export const runsRelations = relations(runs, ({ one, many }) => ({
  client: one(clients, { fields: [runs.clientId], references: [clients.id] }),
  responses: many(responses),
}));

export const responsesRelations = relations(responses, ({ one, many }) => ({
  run: one(runs, { fields: [responses.runId], references: [runs.id] }),
  prompt: one(prompts, { fields: [responses.promptId], references: [prompts.id] }),
  mentions: many(mentions),
  citations: many(citations),
}));

export type PromptCluster = typeof promptClusters.$inferSelect;
export type NewPromptCluster = typeof promptClusters.$inferInsert;
export type Prompt = typeof prompts.$inferSelect;
export type NewPrompt = typeof prompts.$inferInsert;
export type RunSchedule = typeof runSchedules.$inferSelect;
export type NewRunSchedule = typeof runSchedules.$inferInsert;
export type Run = typeof runs.$inferSelect;
export type NewRun = typeof runs.$inferInsert;
export type Response = typeof responses.$inferSelect;
export type NewResponse = typeof responses.$inferInsert;
export type Mention = typeof mentions.$inferSelect;
export type NewMention = typeof mentions.$inferInsert;
export type Citation = typeof citations.$inferSelect;
export type NewCitation = typeof citations.$inferInsert;
