import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createAgency,
  createClient,
  createDb,
  createRun,
  deleteAgency,
  listCitationsByResponse,
  listMentionsByResponse,
  listResponsesByRun,
} from "@repo/db";
import { promptClusters, prompts, runSchedules } from "@repo/db/schema/measurement";
import { orchestrateRun } from "./run-orchestration";
import { parseRun, parseStoredResponse } from "./parse-job";

/** Verify T18 на стороне БД: разбор прогона наполняет mentions и citations. */

const { db, close } = createDb();

describe("parseRun", () => {
  let agencyId = "";
  let runId = "";

  beforeEach(async () => {
    const agency = await createAgency(db, { name: "Parse Agency", clientLimit: 10 });
    agencyId = agency.id;

    const client = await createClient(db, {
      agencyId,
      name: "AcmeCRM",
      domain: "acmecrm.test",
      brandNames: ["AcmeCRM", "Acme CRM", "Acme"],
      competitorNames: ["Northstack", "Pipewell", "Clasp"],
    });

    const cluster = (
      await db
        .insert(promptClusters)
        .values({ clientId: client.id, name: "CRM comparison", intent: "comparison" })
        .returning()
    )[0]!;

    await db
      .insert(prompts)
      .values([{ clusterId: cluster.id, text: "best CRM for startups" }]);

    const scheduleId = (
      await db
        .insert(runSchedules)
        .values({
          clientId: client.id,
          cadence: "weekly",
          platforms: ["perplexity"],
          samplesPerPrompt: 1,
        })
        .returning()
    )[0]!.id;

    runId = (await createRun(db, { clientId: client.id, scheduleId, trigger: "manual" })).id;
    await orchestrateRun(db, runId, "mock");
  });

  afterEach(async () => {
    // Тесты делят одну БД: за собой нужно убирать, иначе чужие проверки
    // начнут зависеть от порядка запуска.
    await deleteAgency(db, agencyId);
  });

  afterAll(async () => {
    await close();
  });

  it("ссылки платформы раскладываются на этапе прогона", async () => {
    const responses = await listResponsesByRun(db, runId);
    const citations = await listCitationsByResponse(db, responses[0]!.id);

    expect(citations.length).toBeGreaterThan(0);
    // Домен нормализован — на нём строится классификация источников (T30).
    expect(citations.map((c) => c.domain)).toContain("reviewgrid.example");
  });

  it("разбор наполняет упоминания клиента и конкурентов", async () => {
    await parseRun(db, runId);

    const responses = await listResponsesByRun(db, runId);
    const mentions = await listMentionsByResponse(db, responses[0]!.id);

    expect(mentions.some((m) => m.isClient && m.entityName === "AcmeCRM")).toBe(true);
    expect(mentions.some((m) => m.isCompetitor && m.entityName === "Northstack")).toBe(true);
    // Позиции 1-based и без дублей.
    expect(new Set(mentions.map((m) => m.position)).size).toBe(mentions.length);
  });

  it("повторный разбор не удваивает данные", async () => {
    await parseRun(db, runId);
    const responses = await listResponsesByRun(db, runId);
    const first = await listMentionsByResponse(db, responses[0]!.id);

    await parseRun(db, runId);
    const second = await listMentionsByResponse(db, responses[0]!.id);

    // Переобработка улучшенным парсером — штатный сценарий, она обязана быть идемпотентной.
    expect(second).toHaveLength(first.length);
  });

  it("падает понятно, если ответа не существует", async () => {
    await expect(parseStoredResponse(db, crypto.randomUUID())).rejects.toThrow(/not found/);
  });

  it("после разбора у клиента без упоминаний нет ложных срабатываний", async () => {
    const agency = await createAgency(db, { name: "Absent Agency", clientLimit: 10 });
    const client = await createClient(db, {
      agencyId: agency.id,
      name: "Unrelated Tool",
      domain: "unrelated.test",
      brandNames: ["Unrelated Tool"],
      competitorNames: ["Asana"],
    });

    const cluster = (
      await db
        .insert(promptClusters)
        .values({ clientId: client.id, name: "c", intent: "comparison" })
        .returning()
    )[0]!;
    await db.insert(prompts).values([{ clusterId: cluster.id, text: "best CRM for startups" }]);
    const scheduleId = (
      await db
        .insert(runSchedules)
        .values({ clientId: client.id, platforms: ["perplexity"], samplesPerPrompt: 1 })
        .returning()
    )[0]!.id;

    const otherRun = (
      await createRun(db, { clientId: client.id, scheduleId, trigger: "manual" })
    ).id;
    await orchestrateRun(db, otherRun, "mock");
    await parseRun(db, otherRun);

    const responses = await listResponsesByRun(db, otherRun);
    const mentions = await listMentionsByResponse(db, responses[0]!.id);
    expect(mentions).toHaveLength(0);

    await deleteAgency(db, agency.id);
  });
});
