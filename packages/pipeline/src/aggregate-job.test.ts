import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createAgency,
  createClient,
  createDb,
  createRun,
  deleteAgency,
  listVisibilitySnapshots,
} from "@repo/db";
import { promptClusters, prompts, runSchedules } from "@repo/db/schema/measurement";
import { orchestrateRun } from "./run-orchestration";
import { parseRun } from "./parse-job";
import { aggregateClient } from "./aggregate-job";
import { makePaying } from "./test-support";

/** Verify T19 на стороне БД: пересчёт идемпотентен и совпадает с ручным счётом. */

const { db, close } = createDb();

describe("aggregateClient", () => {
  let agencyId = "";
  let clientId = "";
  let clusterId = "";

  beforeEach(async () => {
    const agency = await createAgency(db, { name: "Agg Agency", clientLimit: 10 });
    // Growth: Grok в расписании разрешён только с него (07.10.2026).
    await makePaying(db, agency.id, "growth");
    agencyId = agency.id;

    const client = await createClient(db, {
      agencyId,
      name: "AcmeCRM",
      domain: "acmecrm.test",
      brandNames: ["AcmeCRM", "Acme CRM", "Acme"],
      competitorNames: ["Northstack", "Pipewell", "Clasp"],
    });
    clientId = client.id;

    clusterId = (
      await db
        .insert(promptClusters)
        .values({ clientId, name: "CRM comparison", intent: "comparison" })
        .returning()
    )[0]!.id;

    // «best CRM for startups» упоминает клиента на всех трёх платформах,
    // «easiest CRM for a small sales team» — только на gemini (там он под alias «Acme»).
    await db.insert(prompts).values([
      { clusterId, text: "best CRM for startups" },
      { clusterId, text: "easiest CRM for a small sales team" },
    ]);

    const scheduleId = (
      await db
        .insert(runSchedules)
        .values({
          clientId,
          platforms: ["chatgpt", "perplexity", "grok"],
          samplesPerPrompt: 3,
        })
        .returning()
    )[0]!.id;

    const runId = (await createRun(db, { clientId, scheduleId, trigger: "manual" })).id;
    await orchestrateRun(db, runId, "mock");
    await parseRun(db, runId);
  });

  afterEach(async () => {
    await deleteAgency(db, agencyId);
  });

  afterAll(async () => {
    await close();
  });

  it("записывает срезы по кластеру, платформам и свёрткам", async () => {
    await aggregateClient(db, clientId);
    const snapshots = await listVisibilitySnapshots(db, clientId);

    // 1 кластер × 3 платформы + кластер×все + все×платформа (3) + общий = 8 ячеек.
    expect(snapshots).toHaveLength(8);
    expect(snapshots.some((s) => s.clusterId === null && s.platform === null)).toBe(true);
  });

  it("общая доля совпадает с ручным счётом", async () => {
    await aggregateClient(db, clientId);
    const snapshots = await listVisibilitySnapshots(db, clientId);
    const total = snapshots.find((s) => s.clusterId === null && s.platform === null);

    // 18 ответов: 2 промпта × 3 платформы × 3 сэмпла.
    expect(total?.sampleCount).toBe(18);
    // Клиент упомянут в 9 из 18 (по одному промпту на каждой платформе, кроме
    // «easiest CRM» на chatgpt и perplexity, где его нет).
    expect(Number(total?.clientVisibilityPct)).toBeCloseTo(66.7, 1);
    expect(total?.sufficient).toBe(true);
  });

  it("конкуренты попадают в срез", async () => {
    await aggregateClient(db, clientId);
    const total = (await listVisibilitySnapshots(db, clientId)).find(
      (s) => s.clusterId === null && s.platform === null,
    );

    expect(Object.keys(total?.competitorVisibility ?? {})).toContain("Northstack");
    expect(Number(total?.competitorVisibility["Northstack"])).toBeGreaterThan(0);
  });

  it("повторный пересчёт не плодит строки и не меняет цифры", async () => {
    await aggregateClient(db, clientId);
    const first = await listVisibilitySnapshots(db, clientId);

    await aggregateClient(db, clientId);
    const second = await listVisibilitySnapshots(db, clientId);

    // Пересчёт — штатная операция (парсер улучшается, данные переобрабатываются).
    expect(second).toHaveLength(first.length);
    expect(second.map((s) => s.clientVisibilityPct).sort()).toEqual(
      first.map((s) => s.clientVisibilityPct).sort(),
    );
  });

  it("клиент без ответов не порождает срезов и не делит на ноль", async () => {
    const empty = await createClient(db, {
      agencyId,
      name: "No Data",
      domain: "nodata.test",
    });

    expect(await aggregateClient(db, empty.id)).toBe(0);
    expect(await listVisibilitySnapshots(db, empty.id)).toHaveLength(0);
  });
});
