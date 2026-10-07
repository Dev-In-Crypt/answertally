import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MIN_SAMPLES_AFTER } from "@repo/core";
import {
  createAction,
  createAgency,
  createClient,
  createDb,
  createExperiment,
  createRun,
  deleteAgency,
  getExperimentById,
} from "@repo/db";
import { promptClusters, prompts, runSchedules } from "@repo/db/schema/measurement";
import { sources } from "@repo/db/schema/sources";
import { completeRun } from "./complete-run";
import { detectExperimentEvents } from "./experiment-events";

/**
 * Verify: эксперимент сам объявляет себя готовым к оценке.
 *
 * Экран агентства зовёт смотреть «эксперименты, готовые к оценке». Пока
 * статус никто не переключал, это было обещанием, которого никто не держит.
 */

const { db, close } = createDb();

describe("готовность эксперимента", () => {
  let agencyId = "";
  let clientId = "";
  let clusterId = "";

  beforeAll(async () => {
    await db.delete(sources);

    const agency = await createAgency(db, { name: "Readiness Agency", clientLimit: 10 });
    agencyId = agency.id;

    const client = await createClient(db, {
      agencyId,
      name: "AcmeCRM",
      domain: "acmecrm.test",
      brandNames: ["AcmeCRM"],
      competitorNames: ["Northstack", "Pipewell"],
    });
    clientId = client.id;

    clusterId = (
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
        .values({ clientId, platforms: ["chatgpt", "perplexity", "ai-overviews"], samplesPerPrompt: 3 })
        .returning()
    )[0]!.id;

    const runId = (await createRun(db, { clientId, scheduleId, trigger: "manual" })).id;
    await completeRun(db, runId, clientId, "mock");
  });

  afterAll(async () => {
    await deleteAgency(db, agencyId);
    await close();
  });

  async function action(title: string) {
    return createAction(db, {
      clientId,
      title,
      reason: "Cited page does not carry the brand.",
      actionType: "refresh_page",
      affectedClusterIds: [clusterId],
      status: "done",
    });
  }

  it("объявляется готовым, когда после действия набралось достаточно ответов", async () => {
    // Действие в прошлом: все измерения этого прогона попадают в «после».
    const experiment = await createExperiment(db, {
      clientId,
      actionId: (await action("Refresh the comparison page")).id,
      actionDate: new Date(Date.now() - 30 * 86_400_000),
      baselineStart: new Date(Date.now() - 60 * 86_400_000),
      baselineEnd: new Date(Date.now() - 30 * 86_400_000),
      treatmentClusterIds: [clusterId],
      controlClusterIds: [],
      controlPromptIds: [],
      status: "collecting",
    });

    const detected = await detectExperimentEvents(db, clientId);
    const mine = detected.find((row) => row.experimentId === experiment.id);

    expect(MIN_SAMPLES_AFTER).toBeGreaterThan(0);
    expect(mine?.becameReady).toBe(true);
    expect((await getExperimentById(db, experiment.id))?.status).toBe("ready");
  });

  it("остаётся собирающим, пока ответов после действия нет", async () => {
    // Действие «завтра»: измерять после него ещё нечего, и звать смотреть
    // результат было бы враньём.
    const experiment = await createExperiment(db, {
      clientId,
      actionId: (await action("Publish the buyer guide")).id,
      actionDate: new Date(Date.now() + 86_400_000),
      baselineStart: new Date(Date.now() - 30 * 86_400_000),
      baselineEnd: new Date(),
      treatmentClusterIds: [clusterId],
      controlClusterIds: [],
      controlPromptIds: [],
      status: "collecting",
    });

    await detectExperimentEvents(db, clientId);

    expect((await getExperimentById(db, experiment.id))?.status).toBe("collecting");
  });
});
