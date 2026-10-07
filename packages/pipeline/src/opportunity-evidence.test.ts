import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, createAgency, createClient, createRun, deleteAgency, listOpportunities, listOpportunityEvidence } from "@repo/db";
import { promptClusters, prompts, runSchedules } from "@repo/db/schema/measurement";
import { sources } from "@repo/db/schema/sources";
import { completeRun } from "./complete-run";

/**
 * Verify: возможность не может ссылаться на то, чего нет.
 *
 * Доказательство — единственная причина верить оценке. Если возможность
 * ссылается на промпт, которого не существует, или на ответы вне своего окна,
 * то «почему я это вижу» отвечает выдумкой, и весь слой перестаёт стоить
 * чего-либо.
 */

const { db, close } = createDb();

describe("целостность доказательства", () => {
  let agencyId = "";
  let clientId = "";
  let promptIds: string[] = [];

  beforeAll(async () => {
    await db.delete(sources);

    const agency = await createAgency(db, { name: "Evidence Agency", clientLimit: 10 });
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

    const inserted = await db
      .insert(prompts)
      .values([
        { clusterId, text: "best CRM for startups" },
        { clusterId, text: "easiest CRM for a small sales team" },
        { clusterId, text: "what to look for when choosing a CRM" },
      ])
      .returning();
    promptIds = inserted.map((row) => row.id);

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

  it("каждый затронутый промпт существует и принадлежит этому клиенту", async () => {
    const found = await listOpportunities(db, clientId);
    expect(found.length).toBeGreaterThan(0);

    for (const opportunity of found) {
      for (const promptId of opportunity.affectedPromptIds) {
        expect(promptIds).toContain(promptId);
      }
    }
  });

  it("доказательство поднимает те же промпты, что записаны в возможности", async () => {
    for (const opportunity of await listOpportunities(db, clientId)) {
      if (opportunity.affectedPromptIds.length === 0) continue;

      const evidence = await listOpportunityEvidence(db, opportunity);
      const returned = evidence.prompts.map((prompt) => prompt.id).sort();

      expect(returned).toEqual([...opportunity.affectedPromptIds].sort());
    }
  });

  it("ответы в доказательстве лежат внутри окна, за которое посчитана оценка", async () => {
    // Иначе карточка и её объяснение считались бы по разным данным.
    for (const opportunity of await listOpportunities(db, clientId)) {
      if (opportunity.affectedPromptIds.length === 0) continue;

      const evidence = await listOpportunityEvidence(db, opportunity);
      for (const response of evidence.responses) {
        expect(response.createdAt.getTime()).toBeGreaterThanOrEqual(
          opportunity.windowStart.getTime(),
        );
        expect(response.createdAt.getTime()).toBeLessThanOrEqual(opportunity.windowEnd.getTime());
      }
    }
  });

  it("показанных ответов не больше, чем измерено за окно", async () => {
    for (const opportunity of await listOpportunities(db, clientId)) {
      if (opportunity.affectedPromptIds.length === 0) continue;

      const evidence = await listOpportunityEvidence(db, opportunity);
      expect(evidence.responses.length).toBeLessThanOrEqual(evidence.totalResponsesInWindow);
    }
  });
});
