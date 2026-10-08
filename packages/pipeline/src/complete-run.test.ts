import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createAgency,
  createClient,
  createDb,
  createRun,
  deleteAgency,
  listCitationFacts,
  listAllSnapshots,
} from "@repo/db";
import { promptClusters, prompts } from "@repo/db/schema/measurement";
import { sources } from "@repo/db/schema/sources";
import { completeRun } from "./complete-run";
import { makePaying } from "./test-support";

/**
 * Verify T61: одна цепочка доводит прогон до готовой диагностики.
 *
 * Таблица `sources` глобальная, поэтому она чистится перед каждым тестом:
 * иначе классификация выглядела бы работающей за счёт строк, оставленных
 * другими тестами (именно так эта дыра и пряталась).
 */

const { db, close } = createDb();

afterAll(async () => {
  await close();
});

describe("completeRun", () => {
  let agencyId = "";
  let clientId = "";

  beforeEach(async () => {
    await db.delete(sources);

    const agency = await createAgency(db, { name: "Audit Agency", clientLimit: 10 });
    await makePaying(db, agency.id);
    agencyId = agency.id;

    const client = await createClient(db, {
      agencyId,
      name: "AcmeCRM",
      domain: "acmecrm.test",
      brandNames: ["AcmeCRM", "Acme"],
      competitorNames: ["Northstack", "Pipewell"],
      status: "prospect",
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
  });

  afterEach(async () => {
    await deleteAgency(db, agencyId);
  });

  it("без расписания меряет все платформы, а не одну", async () => {
    const run = await createRun(db, { clientId, scheduleId: null, trigger: "manual" });
    const outcome = await completeRun(db, run.id, clientId, "mock");

    // 2 промпта × 3 платформы по умолчанию (ChatGPT, Perplexity, Claude) × 3 сэмпла.
    expect(outcome.responses).toBe(18);
    expect(outcome.status).toBe("done");
    expect(outcome.failed).toBe(0);
    expect(outcome.parsedResponses).toBe(18);
  });

  it("источники классифицированы — диагностике есть что показывать", async () => {
    const run = await createRun(db, { clientId, scheduleId: null, trigger: "manual" });
    const outcome = await completeRun(db, run.id, clientId, "mock");

    expect(outcome.classifiedDomains).toBeGreaterThan(0);

    const facts = await listCitationFacts(db, clientId, null);
    expect(facts.length).toBeGreaterThan(0);

    // Главная проверка: типы проставлены. Часть доменов остаётся без типа
    // по замыслу (словарь их не знает) — но известные обязаны быть узнаны.
    const byDomain = new Map(facts.map((fact) => [fact.domain, fact.sourceType]));
    expect(byDomain.get("reviewgrid.example")).toBe("review");
    expect(byDomain.get("acmecrm.test")).toBe("owned");
    expect(facts.some((fact) => fact.sourceType !== null)).toBe(true);
  });

  it("срезы видимости посчитаны той же цепочкой", async () => {
    const run = await createRun(db, { clientId, scheduleId: null, trigger: "manual" });
    const outcome = await completeRun(db, run.id, clientId, "mock");

    expect(outcome.snapshots).toBeGreaterThan(0);

    const snapshots = await listAllSnapshots(db, clientId);
    const rollup = snapshots.find((row) => row.clusterId === null && row.platform === null);
    expect(rollup).toBeDefined();
    expect(Number(rollup?.clientVisibilityPct)).toBeGreaterThanOrEqual(0);
  });

  it("повторный аудит не ломает уже посчитанное", async () => {
    const first = await createRun(db, { clientId, scheduleId: null, trigger: "manual" });
    await completeRun(db, first.id, clientId, "mock");

    const second = await createRun(db, { clientId, scheduleId: null, trigger: "manual" });
    const outcome = await completeRun(db, second.id, clientId, "mock");

    expect(outcome.status).toBe("done");
    expect(outcome.snapshots).toBeGreaterThan(0);
  });
});
