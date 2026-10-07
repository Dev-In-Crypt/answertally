import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { diagnose, DIAGNOSIS_COPY } from "@repo/core";
import type { CitationFact, SourceType } from "@repo/core";
import {
  createAgency,
  createClient,
  createDb,
  createRun,
  deleteAgency,
  listCitationFacts,
} from "@repo/db";
import { promptClusters, prompts, runSchedules } from "@repo/db/schema/measurement";
import { sources } from "@repo/db/schema/sources";
import { orchestrateRun } from "./run-orchestration";
import { parseRun } from "./parse-job";
import { classifyRunSources } from "./classify-sources";

/** Verify T32 на реальных данных: диагностика собирается из прогона целиком. */

const { db, close } = createDb();

/** Та же схлопка, что и в роутере: один факт на пару (ответ, домен). */
function toFacts(rows: Awaited<ReturnType<typeof listCitationFacts>>): CitationFact[] {
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

describe("diagnosis на данных прогона", () => {
  let agencyId = "";
  let clientId = "";

  beforeEach(async () => {
    await db.delete(sources);

    const agency = await createAgency(db, { name: "Diag Agency", clientLimit: 10 });
    agencyId = agency.id;

    const client = await createClient(db, {
      agencyId,
      name: "AcmeCRM",
      domain: "acmecrm.test",
      brandNames: ["AcmeCRM", "Acme CRM", "Acme"],
      competitorNames: ["Northstack", "Pipewell", "Clasp"],
    });
    clientId = client.id;

    const clusterId = (
      await db
        .insert(promptClusters)
        .values({ clientId, name: "CRM comparison", intent: "comparison" })
        .returning()
    )[0]!.id;

    await db.insert(prompts).values([
      { clusterId, text: "best CRM for startups" },
      { clusterId, text: "easiest CRM for a small sales team" },
    ]);

    const scheduleId = (
      await db
        .insert(runSchedules)
        .values({
          clientId,
          platforms: ["chatgpt", "perplexity", "ai-overviews"],
          samplesPerPrompt: 2,
        })
        .returning()
    )[0]!.id;

    const runId = (await createRun(db, { clientId, scheduleId, trigger: "manual" })).id;
    await orchestrateRun(db, runId, "mock");
    await parseRun(db, runId);
    await classifyRunSources(db, runId);
  });

  afterEach(async () => {
    await deleteAgency(db, agencyId);
  });

  afterAll(async () => {
    await close();
  });

  it("собирает распределение типов источников", async () => {
    const diagnosis = diagnose(toFacts(await listCitationFacts(db, clientId)));

    expect(diagnosis.mix.length).toBeGreaterThan(0);
    const total = diagnosis.mix.reduce((sum, entry) => sum + entry.sharePct, 0);
    // Доли складываются в 100% с точностью до округления.
    expect(total).toBeGreaterThan(99);
    expect(total).toBeLessThan(101);
  });

  it("находит влиятельные источники с типами", async () => {
    const diagnosis = diagnose(toFacts(await listCitationFacts(db, clientId)));

    const reviews = diagnosis.influential.find((s) => s.domain === "reviewgrid.example");
    expect(reviews).toBeDefined();
    expect(reviews?.sourceType).toBe("review");
    expect(reviews?.citations).toBeGreaterThan(0);
  });

  it("собственный домен клиента опознан как owned", async () => {
    const diagnosis = diagnose(toFacts(await listCitationFacts(db, clientId)));

    const own = diagnosis.influential.find((s) => s.domain === "acmecrm.test");
    expect(own?.sourceType).toBe("owned");
  });

  it("присутствие конкурентов зафиксировано", async () => {
    const diagnosis = diagnose(toFacts(await listCitationFacts(db, clientId)));

    expect(diagnosis.gap.competitorPresentIn).toBeGreaterThan(0);
    expect(diagnosis.influential.some((s) => s.competitorsPresent.includes("Northstack"))).toBe(true);
  });

  it("вывод берётся из copy-констант, а не сочиняется", async () => {
    const diagnosis = diagnose(toFacts(await listCitationFacts(db, clientId)));

    expect(Object.values(DIAGNOSIS_COPY)).toContain(diagnosis.statement);
  });

  it("фильтр по кластеру сужает выборку, а не ломает её", async () => {
    // Именно свой кластер: в общей БД лежат кластеры seed и других тестов.
    const clusters = await db
      .select()
      .from(promptClusters)
      .where(eq(promptClusters.clientId, clientId));
    const clusterId = clusters[0]!.id;

    const scoped = toFacts(await listCitationFacts(db, clientId, clusterId));
    const all = toFacts(await listCitationFacts(db, clientId));

    expect(scoped.length).toBeGreaterThan(0);
    expect(scoped.length).toBeLessThanOrEqual(all.length);
  });
});
