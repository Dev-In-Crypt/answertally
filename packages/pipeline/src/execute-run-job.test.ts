import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  countResponsesByRun,
  createAgency,
  createClient,
  createDb,
  createRun,
  deleteAgency,
  upsertSubscription,
} from "@repo/db";
import { promptClusters, prompts } from "@repo/db/schema/measurement";
import { executeRunJob } from "./run-orchestration";

/**
 * Задача ответа — платный вызов. Повтор задачи (воркер упал посреди вызова)
 * и задача ушедшего агентства не должны платить.
 */

const { db, close } = createDb();

afterAll(async () => {
  await close();
});

describe("executeRunJob", () => {
  let agencyId = "";
  let runId = "";
  let promptId = "";

  beforeEach(async () => {
    agencyId = (await createAgency(db, { name: "Job Agency", clientLimit: 3 })).id;
    const clientId = (await createClient(db, { agencyId, name: "Job", domain: "job.test" })).id;
    const cluster = (
      await db.insert(promptClusters).values({ clientId, name: "C", intent: "other" }).returning()
    )[0]!;
    promptId = (
      await db.insert(prompts).values({ clusterId: cluster.id, text: "best CRM" }).returning()
    )[0]!.id;
    runId = (
      await createRun(db, { clientId, scheduleId: null, trigger: "manual", adaptersMode: "mock" })
    ).id;
  });

  afterEach(async () => {
    await deleteAgency(db, agencyId);
  });

  it("повтор того же сэмпла не спрашивает ассистента второй раз", async () => {
    const job = {
      runId,
      promptId,
      promptText: "best CRM",
      platform: "chatgpt" as const,
      sampleIndex: 0,
    };

    const first = await executeRunJob(db, job, "mock");
    const second = await executeRunJob(db, job, "mock");

    expect(second).toBe(first);
    expect(await countResponsesByRun(db, runId)).toBe(1);
  });

  it("у отменившего подписку живая задача ничего не вызывает", async () => {
    await upsertSubscription(db, {
      agencyId,
      customerId: `cus_${agencyId.slice(0, 8)}`,
      subscriptionId: `sub_${agencyId.slice(0, 8)}`,
      plan: "starter",
      status: "canceled",
      currentPeriodEnd: new Date("2000-01-01T00:00:00.000Z"),
      cancelAtPeriodEnd: false,
    });
    const job = {
      runId,
      promptId,
      promptText: "best CRM",
      platform: "chatgpt" as const,
      sampleIndex: 0,
      agencyId,
    };

    // Живой режим без ключей упал бы на создании адаптера — но до него
    // дело не доходит: проверка подписки раньше.
    expect(await executeRunJob(db, job, "live")).toBeNull();
    expect(await countResponsesByRun(db, runId)).toBe(0);
  });
});
