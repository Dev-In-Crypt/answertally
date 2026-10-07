import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createAgency,
  createClient,
  createDb,
  createRun,
  deleteAgency,
  listResponsesByRun,
  upsertSubscription,
} from "@repo/db";
import { promptClusters, prompts, runSchedules } from "@repo/db/schema/measurement";
import { subscriptions } from "@repo/db/schema/billing";
import { eq } from "drizzle-orm";
import { DEFAULT_PLAN } from "@repo/core";
import { capabilitiesFor } from "@repo/core/config/measurement";
import { orchestrateRun, planRunJobs } from "./run-orchestration";
import { makePaying } from "./test-support";

/** Verify T17: 2 промпта × 3 платформы × 3 сэмпла = ровно 18 ответов, run.status=done. */

const { db, close } = createDb();

describe("planRunJobs", () => {
  const twoPrompts = [
    { id: "p1", text: "best CRM for startups" },
    { id: "p2", text: "Northstack alternatives" },
  ];

  it("раскладывает прогон в промпт × платформа × сэмпл", () => {
    const jobs = planRunJobs("run-1", twoPrompts, ["chatgpt", "perplexity", "grok"], 3);
    expect(jobs).toHaveLength(18);
  });

  it("каждая тройка (промпт, платформа, сэмпл) встречается ровно один раз", () => {
    const jobs = planRunJobs("run-1", twoPrompts, ["chatgpt", "perplexity"], 2);
    const keys = jobs.map((j) => `${j.promptId}|${j.platform}|${j.sampleIndex}`);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("пустой список промптов даёт пустой план, а не падение", () => {
    expect(planRunJobs("run-1", [], ["chatgpt"], 3)).toHaveLength(0);
  });

  it("нулевое число сэмплов отвергается — это молча сломало бы измерение", () => {
    expect(() => planRunJobs("run-1", twoPrompts, ["chatgpt"], 0)).toThrow(/samplesPerPrompt/);
  });
});

describe("orchestrateRun (mock-режим)", () => {
  let agencyId = "";
  let clientId = "";
  let scheduleId = "";
  let runId = "";

  beforeEach(async () => {
    const agency = await createAgency(db, { name: "Run Agency", clientLimit: 10 });
    await makePaying(db, agency.id);
    agencyId = agency.id;
    const client = await createClient(db, {
      agencyId,
      name: "AcmeCRM",
      domain: "acmecrm.test",
      brandNames: ["AcmeCRM", "Acme CRM"],
      competitorNames: ["Northstack", "Pipewell"],
    });
    clientId = client.id;

    const cluster = (
      await db
        .insert(promptClusters)
        .values({ clientId, name: "CRM comparison", intent: "comparison" })
        .returning()
    )[0]!;

    await db.insert(prompts).values([
      { clusterId: cluster.id, text: "best CRM for startups" },
      { clusterId: cluster.id, text: "Northstack alternatives" },
    ]);

    scheduleId = (
      await db
        .insert(runSchedules)
        .values({
          clientId,
          cadence: "weekly",
          // Набор Starter по умолчанию с 07.10.2026; Grok — с Growth.
          platforms: ["chatgpt", "perplexity", "ai-overviews"],
          samplesPerPrompt: 3,
        })
        .returning()
    )[0]!.id;

    runId = (await createRun(db, { clientId, scheduleId, trigger: "manual" })).id;
  });

  afterEach(async () => {
    // Тесты делят одну БД: за собой нужно убирать, иначе чужие проверки
    // начнут зависеть от порядка запуска.
    await deleteAgency(db, agencyId);
  });

  afterAll(async () => {
    await close();
  });

  it("2 промпта × 3 платформы × 3 сэмпла дают ровно 18 ответов и статус done", async () => {
    const outcome = await orchestrateRun(db, runId, "mock");

    expect(outcome.expected).toBe(18);
    expect(outcome.written).toBe(18);
    expect(outcome.failed).toBe(0);
    expect(outcome.status).toBe("done");

    const written = await listResponsesByRun(db, runId);
    expect(written).toHaveLength(18);
  });

  it("на каждом ответе есть версия модели и стоимость", async () => {
    await orchestrateRun(db, runId, "mock");
    const written = await listResponsesByRun(db, runId);

    for (const response of written) {
      // Инвариант 6: без model_version история измерений несравнима между собой.
      expect(response.modelVersion).not.toBe("");
      expect(Number(response.costUsd)).toBeGreaterThan(0);
      expect(response.rawText.length).toBeGreaterThan(0);
    }
  });

  it("сырой ответ уходит в storage — переобработка парсером возможна", async () => {
    await orchestrateRun(db, runId, "mock");
    const written = await listResponsesByRun(db, runId);

    for (const response of written) {
      expect(response.rawStorageKey).toMatch(new RegExp(`^runs/${runId}/`));
    }
  });

  it("сэмплы одного промпта покрывают все три платформы", async () => {
    await orchestrateRun(db, runId, "mock");
    const written = await listResponsesByRun(db, runId);

    const platforms = new Set(written.map((r) => r.platform));
    expect([...platforms].sort()).toEqual(["ai-overviews", "chatgpt", "perplexity"]);

    const perPlatform = written.filter((r) => r.platform === "chatgpt");
    expect(perPlatform).toHaveLength(6); // 2 промпта × 3 сэмпла
  });

  it("прогон без расписания берёт набор, который даёт тариф", async () => {
    /**
     * Не общий литерал: с тех пор как тарифы развели по ассистентам, общего
     * умолчания не существует. Прогон по ассистенту, которого тариф не даёт,
     * потратил бы наши деньги на то, за что агентство не платило.
     *
     * У агентства из теста подписки нет, значит действует умолчание —
     * младший тариф. Ожидание берётся из того же конфига, что и поведение:
     * вписать сюда три имени значило бы завести вторую точку правды, которая
     * разойдётся с первой при следующем решении по тарифам.
     */
    const bare = await createRun(db, { clientId, scheduleId: null, trigger: "manual" });

    const outcome = await orchestrateRun(db, bare.id, "mock");
    const platforms = new Set((await listResponsesByRun(db, bare.id)).map((r) => r.platform));

    expect(outcome.status).toBe("done");
    expect([...platforms].sort()).toEqual(
      [...capabilitiesFor(DEFAULT_PLAN).defaultAssistants].sort(),
    );
  });

  it("ассистент, которого больше не даёт тариф, из прогона выпадает", async () => {
    /**
     * Расписание переживает переход на младший тариф: строку с ним никто не
     * переписывает. Спрашивать ассистента, за которого агентство не платит,
     * значит тратить наши деньги на то, о чём не просили.
     *
     * Молчаливым это не остаётся — форма показывает такой ассистент
     * отдельной пометкой и говорит, что измерение по нему остановлено.
     */
    await db
      .update(runSchedules)
      .set({ platforms: ["chatgpt", "claude"] })
      .where(eq(runSchedules.id, scheduleId));

    const outcome = await orchestrateRun(db, runId, "mock");
    const written = await listResponsesByRun(db, runId);

    expect(outcome.status).toBe("done");
    expect([...new Set(written.map((r) => r.platform))]).toEqual(["chatgpt"]);
  });

  it("до первой оплаты Grok не спрашивается, даже если стоит в расписании", async () => {
    /**
     * Бесплатный аудит — единственное место, где мы платим за ответы, не
     * получив ничего, и единственное без верхней границы: аккаунт заводится
     * на любой адрес. Grok стоит $0.1058 за ответ — дороже всех, и это 89%
     * цены круга по тройке. Один аудит с ним обходится в $8.55, без него в
     * $0.94.
     *
     * Проверяется именно прогон, а не форма: форму можно обойти, а деньги
     * тратятся здесь.
     */
    await db.delete(subscriptions).where(eq(subscriptions.agencyId, agencyId));
    await db
      .update(runSchedules)
      .set({ platforms: ["chatgpt", "perplexity", "grok"] })
      .where(eq(runSchedules.id, scheduleId));

    const outcome = await orchestrateRun(db, runId, "mock");
    const written = await listResponsesByRun(db, runId);

    expect(outcome.status).toBe("done");
    expect([...new Set(written.map((r) => r.platform))].sort()).toEqual(["chatgpt", "perplexity"]);
    // Что заплатившему Grok достаётся — проверяет соседний тест ниже;
    // повторять это здесь значило бы завести вторую точку правды.
  });

  it("платформа, которую перестали измерять, из старого расписания выпадает", async () => {
    /**
     * Расписание переживает такое решение: строку с ним никто не
     * переписывает, потому что данные мы не удаляем. Значит прогон обязан
     * сверяться с каталогом сам — иначе клиент, у которого Gemini включён
     * с прошлого года, продолжал бы его опрашивать.
     */
    await db
      .update(runSchedules)
      .set({ platforms: ["chatgpt", "gemini"] })
      .where(eq(runSchedules.id, scheduleId));

    const outcome = await orchestrateRun(db, runId, "mock");
    const written = await listResponsesByRun(db, runId);

    expect(outcome.status).toBe("done");
    expect([...new Set(written.map((r) => r.platform))]).toEqual(["chatgpt"]);
  });

  it("Claude и Grok измеряются, когда включены в расписании клиента", async () => {
    // Claude даёт только старший тариф, поэтому агентству нужна подписка:
    // иначе тест проверял бы не то, что заявлено в названии.
    await upsertSubscription(db, {
      agencyId,
      customerId: `cus_${agencyId.slice(0, 8)}`,
      plan: "scale",
      status: "active",
    });
    await db
      .update(runSchedules)
      .set({ platforms: ["chatgpt", "claude", "grok"] })
      .where(eq(runSchedules.id, scheduleId));

    const outcome = await orchestrateRun(db, runId, "mock");
    const written = await listResponsesByRun(db, runId);

    // 2 промпта × 3 платформы × 3 сэмпла.
    expect(outcome).toMatchObject({ expected: 18, written: 18, failed: 0, status: "done" });
    expect([...new Set(written.map((r) => r.platform))].sort()).toEqual([
      "chatgpt",
      "claude",
      "grok",
    ]);
    for (const response of written.filter((r) => r.platform !== "chatgpt")) {
      // Инвариант 6 действует и для новых платформ.
      expect(response.modelVersion).not.toBe("");
      expect(Number(response.costUsd)).toBeGreaterThan(0);
    }
  });

  it("повторная оркестрация того же прогона не удваивает ответы", async () => {
    await orchestrateRun(db, runId, "mock");
    const second = await orchestrateRun(db, runId, "mock");

    // Записанный сэмпл не спрашивается второй раз: повтор после падения
    // воркера не платит за ответ дважды и не пишет дубль.
    expect(second.failed).toBe(0);
    expect(second.written).toBe(18);
    expect(await listResponsesByRun(db, runId)).toHaveLength(18);
  });
});
