import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { completeRun } from "@repo/pipeline";
import {
  createAgency,
  createClient,
  createDb,
  createRun,
  createUser,
  deleteAgency,
  listAllSnapshots,
  listOpportunities,
  listPromptsByClient,
} from "@repo/db";
import { promptClusters, prompts, runSchedules } from "@repo/db/schema/measurement";
import { appRouter } from "./root";
import type { SessionUser, TrpcContext } from "./context";

/**
 * Verify: проспект становится клиентом, ничего не теряя.
 *
 * Смысл бесплатного аудита в том, что после согласия работу не начинают
 * заново. Промпты, конкуренты, измерения и найденные возможности — это уже те
 * же строки; конверсия обязана быть сменой статуса, а не пересборкой.
 */

const { db, close } = createDb();

afterAll(async () => {
  await close();
});

function caller(userId: string, agencyId: string) {
  const user: SessionUser = {
    id: userId,
    email: "owner@prospect.test",
    name: "Owner",
    agencyId,
    role: "owner",
  };
  return appRouter.createCaller({ db, user } as TrpcContext);
}

describe("конверсия проспекта в клиента", () => {
  let agencyId = "";
  let userId = "";
  let clientId = "";

  beforeAll(async () => {
    const agency = await createAgency(db, { name: "Prospect Agency", clientLimit: 10 });
    agencyId = agency.id;

    const user = await createUser(db, {
      agencyId,
      email: `owner-${crypto.randomUUID()}@prospect.test`,
      name: "Owner",
      role: "owner",
    });
    userId = user.id;

    const client = await createClient(db, {
      agencyId,
      name: "AcmeCRM",
      domain: "acmecrm.test",
      brandNames: ["AcmeCRM", "Acme CRM", "Acme"],
      competitorNames: ["Northstack", "Pipewell", "Clasp"],
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
      { clusterId, text: "what to look for when choosing a CRM" },
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
  });

  it("после аудита у проспекта есть измерения и найденные возможности", async () => {
    expect((await listAllSnapshots(db, clientId)).length).toBeGreaterThan(0);
    expect((await listOpportunities(db, clientId)).length).toBeGreaterThan(0);
  });

  it("предлагает конкурентов из того, что модели уже цитируют", async () => {
    const suggested = await caller(userId, agencyId).diagnosis.suggestedCompetitors({ clientId });

    // Ни одной выдуманной компании: только домены, встреченные в ответах.
    for (const candidate of suggested) {
      expect(candidate.domain).toMatch(/\./);
      expect(candidate.citations).toBeGreaterThan(1);
    }
  });

  it("конверсия — смена статуса, а всё измеренное остаётся на месте", async () => {
    const promptsBefore = (await listPromptsByClient(db, clientId)).map((row) => row.id).sort();
    const snapshotsBefore = (await listAllSnapshots(db, clientId)).length;
    const opportunitiesBefore = (await listOpportunities(db, clientId)).map((row) => row.id).sort();

    const converted = await caller(userId, agencyId).clients.update({
      id: clientId,
      status: "active",
    });
    expect(converted?.status).toBe("active");

    expect((await listPromptsByClient(db, clientId)).map((row) => row.id).sort()).toEqual(
      promptsBefore,
    );
    expect((await listAllSnapshots(db, clientId)).length).toBe(snapshotsBefore);
    expect((await listOpportunities(db, clientId)).map((row) => row.id).sort()).toEqual(
      opportunitiesBefore,
    );
    // Конкуренты — тот же список, который вводили при заведении проспекта.
    expect(converted?.competitorNames).toEqual(["Northstack", "Pipewell", "Clasp"]);
  });
});
