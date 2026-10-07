import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createAgency,
  createClient,
  createDb,
  createResponse,
  createRun,
  deleteAgency,
  effectiveAdaptersMode,
  listAllSnapshots,
  listCitationFacts,
} from "@repo/db";
import { promptClusters, prompts } from "@repo/db/schema/measurement";
import { sources } from "@repo/db/schema/sources";
import { completeRun } from "./complete-run";
import { parseStoredResponse, storeCitations } from "./parse-job";
import { classifyRunSources } from "./classify-sources";
import { aggregateClient } from "./aggregate-job";
import { makePaying } from "./test-support";

/**
 * Фикстуры не должны попадать в метрики клиента, которого меряли по-настоящему.
 *
 * Случай не выдуманный: на стенде с ADAPTERS_MODE=mock достаточно нажать «Run»,
 * и в график клиента лягут ответы про чужую выдуманную компанию. Цифра, которая
 * так собирается, не измерение (инвариант 6).
 */

const { db, close } = createDb();

afterAll(async () => {
  await close();
});

describe("изоляция режимов адаптеров", () => {
  let agencyId = "";
  let clientId = "";
  let promptId = "";

  beforeEach(async () => {
    await db.delete(sources);

    agencyId = (await createAgency(db, { name: "Mode Agency", clientLimit: 10 })).id;
    await makePaying(db, agencyId);
    const client = await createClient(db, {
      agencyId,
      name: "Pisto",
      domain: "agenciapisto.test",
      brandNames: ["Pisto"],
      competitorNames: ["NeoAttack"],
    });
    clientId = client.id;

    const clusterId = (
      await db
        .insert(promptClusters)
        .values({ clientId, name: "Búsqueda", intent: "comparison" })
        .returning()
    )[0]!.id;

    promptId = (
      await db.insert(prompts).values({ clusterId, text: "mejor agencia" }).returning()
    )[0]!.id;
  });

  afterEach(async () => {
    await deleteAgency(db, agencyId);
  });

  /** Живой ответ, где клиент назван, а конкурент — нет. */
  async function addLiveResponse(): Promise<void> {
    const run = await createRun(db, {
      clientId,
      scheduleId: null,
      trigger: "manual",
      adaptersMode: "live",
    });

    const response = await createResponse(db, {
      runId: run.id,
      promptId,
      platform: "chatgpt",
      modelVersion: "gpt-5.6-luna (reasoning: medium)",
      sampleIndex: 0,
      rawText: "La mejor opción es Pisto, con oficinas en Madrid.",
      costUsd: "0.024500",
    });

    await parseStoredResponse(db, response.id);
    // Цитаты приходят от адаптера, а не вычитываются из текста, — как в проде.
    await storeCitations(db, response.id, [{ url: "https://agenciapisto.test/es", title: "Pisto" }]);
    await classifyRunSources(db, run.id);
  }

  it("до живого прогона клиент считается по фикстурам — стенд остаётся рабочим", async () => {
    expect(await effectiveAdaptersMode(db, clientId)).toBe("mock");

    const run = await createRun(db, { clientId, scheduleId: null, trigger: "manual" });
    await completeRun(db, run.id, clientId, "mock");

    const snapshots = await listAllSnapshots(db, clientId);
    expect(snapshots.length).toBeGreaterThan(0);
  });

  it("после живого прогона фикстуры выпадают из метрик", async () => {
    await addLiveResponse();
    expect(await effectiveAdaptersMode(db, clientId)).toBe("live");

    // Кто-то нажал «Run» на стенде: 3 платформы × фикстуры.
    const mockRun = await createRun(db, { clientId, scheduleId: null, trigger: "manual" });
    await completeRun(db, mockRun.id, clientId, "mock");

    await aggregateClient(db, clientId);
    const rollup = (await listAllSnapshots(db, clientId)).find(
      (row) => row.clusterId === null && row.platform === null,
    );

    // В свёртке только живой ответ, а не он вместе с 27 фикстурными.
    expect(rollup?.sampleCount).toBe(1);
    expect(Number(rollup?.clientVisibilityPct)).toBe(100);
  });

  it("срезы по платформам, которые перестали учитываться, удаляются", async () => {
    // Сначала стенд намерял обе платформы по умолчанию фикстурами.
    const mockRun = await createRun(db, { clientId, scheduleId: null, trigger: "manual" });
    await completeRun(db, mockRun.id, clientId, "mock");

    const before = (await listAllSnapshots(db, clientId)).filter((row) => row.platform !== null);
    expect(new Set(before.map((row) => row.platform)).size).toBe(2);

    // Потом появилось живое измерение по одному ChatGPT.
    await addLiveResponse();
    await aggregateClient(db, clientId);

    const after = (await listAllSnapshots(db, clientId)).filter((row) => row.platform !== null);
    // Иначе отчёт сказал бы «several platforms», измерив одну.
    expect([...new Set(after.map((row) => row.platform))]).toEqual(["chatgpt"]);
  });

  it("диагностика тоже смотрит только на живые цитаты", async () => {
    await addLiveResponse();

    const mockRun = await createRun(db, { clientId, scheduleId: null, trigger: "manual" });
    await completeRun(db, mockRun.id, clientId, "mock");

    const facts = await listCitationFacts(db, clientId, null);
    const domains = facts.map((fact) => fact.domain);

    // reviewgrid.example и прочее приходят только из фикстур.
    expect(domains).not.toContain("reviewgrid.example");
    expect(domains).toContain("agenciapisto.test");
  });
});
