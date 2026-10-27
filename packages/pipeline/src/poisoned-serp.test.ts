import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { registerLiveAdapter, type AdapterResult } from "@repo/core";
import {
  createAgency,
  createClient,
  createDb,
  createResponse,
  createRun,
  deleteAgency,
  getRunById,
  listAllSnapshots,
  listResponsesByRun,
} from "@repo/db";
import { promptClusters, prompts } from "@repo/db/schema/measurement";
import { executeRunJob, planRunJobs } from "./run-orchestration";
import { finalizeRun } from "./finalize-run";
import { makePaying } from "./test-support";

/**
 * «Отравленная» выдача Google: органика почти вся чужая, AI Overview нет.
 * Записать её как «бренд не назван» — занизить видимость. Такое чтение
 * перечитывается один раз и, если не исправилось, не считается: ячейка
 * с недобором видна недобором (C3), а не нулём.
 */

const { db, close } = createDb();

afterAll(async () => {
  await close();
});

const top = (...ids: number[]) => ids.map((i) => `site${i}.com`);
const NORMAL = top(1, 2, 3, 4, 5, 6, 7, 8, 9, 10);

function read(serpDomains: string[], text = "Acme is a solid pick."): AdapterResult {
  return { text, citations: [], modelVersion: "dataforseo-test", costUsd: 0.002, latencyMs: 1, serpDomains };
}

describe("отсев отравленных чтений Google", () => {
  let agencyId = "";
  let clientId = "";
  let clusterId = "";
  let promptId = "";
  let runId = "";
  let script: AdapterResult[] = [];
  let calls = 0;

  registerLiveAdapter("ai-overviews", () => ({
    platform: "ai-overviews",
    execute: async () => {
      const next = script[calls++];
      if (!next) throw new Error("script exhausted");
      return next;
    },
  }));

  beforeEach(async () => {
    script = [];
    calls = 0;
    agencyId = (await createAgency(db, { name: "Serp Agency", clientLimit: 3 })).id;
    await makePaying(db, agencyId);
    clientId = (
      await createClient(db, { agencyId, name: "Acme", domain: "acme.test", brandNames: ["Acme"] })
    ).id;
    clusterId = (
      await db.insert(promptClusters).values({ clientId, name: "C", intent: "other" }).returning()
    )[0]!.id;
    promptId = (await db.insert(prompts).values({ clusterId, text: "best crm" }).returning())[0]!.id;

    // Прошлая неделя: два согласных чтения — образцы. В текущую ячейку не попадают.
    const previous = await createRun(db, { clientId, scheduleId: null, trigger: "manual", adaptersMode: "live" });
    const lastWeek = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
    for (const sampleIndex of [0, 1]) {
      await createResponse(db, {
        runId: previous.id,
        promptId,
        platform: "ai-overviews",
        modelVersion: "dataforseo-test",
        sampleIndex,
        rawText: "Acme is a solid pick.",
        serpDomains: sampleIndex === 0 ? NORMAL : top(1, 2, 3, 4, 5, 6, 7, 8, 9, 11),
        createdAt: lastWeek,
      });
    }

    runId = (await createRun(db, { clientId, scheduleId: null, trigger: "manual", adaptersMode: "live" })).id;
  });

  afterEach(async () => {
    await deleteAgency(db, agencyId);
  });

  async function runThreeSamples() {
    const jobs = planRunJobs(runId, [{ id: promptId, text: "best crm" }], ["ai-overviews"], 3);
    for (const job of jobs) await executeRunJob(db, { ...job, agencyId }, "live");
  }

  it("чтение, отравленное и после повтора, не считается, а ячейка — недобор, не ноль", async () => {
    script = [
      read(NORMAL),
      // Отравленная страница, и повтор — другая отравленная.
      read(top(1, 21, 22, 23, 24, 25, 26, 27, 28, 29), "Google showed no AI answer for this question."),
      read(top(2, 31, 32, 33, 34, 35, 36, 37, 38, 39), "Google showed no AI answer for this question."),
      read(NORMAL),
    ];

    await runThreeSamples();

    expect(calls).toBe(4); // ровно один лишний вызов
    const responses = await listResponsesByRun(db, runId);
    expect(responses.map((r) => r.sampleIndex).sort()).toEqual([0, 2]);
    expect((await getRunById(db, runId))?.excludedReads).toBe(1);

    const outcome = await finalizeRun(db, { runId, clientId, expected: 3 });
    expect(outcome.status).toBe("done");
    expect((await getRunById(db, runId))?.note).toMatch(/1 Google read was left out/);

    const cell = (await listAllSnapshots(db, clientId)).find(
      (s) => s.clusterId === clusterId && s.platform === "ai-overviews" && s.periodStart > new Date(Date.now() - 7 * 864e5),
    );
    expect(cell?.sampleCount).toBe(2);
    expect(cell?.sufficient).toBe(false);
  });

  it("повтор исправился — берётся он, и платим за оба вызова", async () => {
    script = [read(NORMAL), read(top(21, 22, 23, 24, 25, 26, 27, 28, 29, 30)), read(NORMAL), read(NORMAL)];

    await runThreeSamples();

    const responses = await listResponsesByRun(db, runId);
    expect(responses).toHaveLength(3);
    const retried = responses.find((r) => r.sampleIndex === 1)!;
    expect(retried.serpDomains).toEqual(NORMAL);
    expect(Number(retried.costUsd)).toBeCloseTo(0.004);
    expect((await getRunById(db, runId))?.excludedReads).toBe(0);
  });

  it("две одинаковые новые страницы подряд — смена выдачи, а не отравление", async () => {
    const changed = top(51, 52, 53, 54, 55, 56, 57, 58, 59, 60);
    script = Array.from({ length: 6 }, () => read(changed));

    await runThreeSamples();

    // Два первых чтения перечитаны и приняты; к третьему новая страница
    // уже сама стала образцом, и повтор не нужен.
    expect(calls).toBe(5);
    expect(await listResponsesByRun(db, runId)).toHaveLength(3);
  });
});
