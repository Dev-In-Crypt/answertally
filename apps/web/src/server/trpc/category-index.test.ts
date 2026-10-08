import { afterAll, afterEach, describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  createAgency,
  createClient,
  createDb,
  createPrompt,
  createPromptCluster,
  createResponse,
  createRun,
  deleteAgency,
} from "@repo/db";
import { citations } from "@repo/db/schema/measurement";
import { appRouter } from "./root";
import type { SessionUser, TrpcContext } from "./context";

/**
 * Общий индекс источников категории: виден от трёх агентств, без доменов
 * клиентов категории, чужой клиент неотличим от несуществующего.
 */

const { db, close } = createDb();
const CATEGORY = "scheduling-software";
const agencies: string[] = [];

afterAll(async () => {
  await close();
});

afterEach(async () => {
  for (const id of agencies.splice(0)) await deleteAgency(db, id);
});

function caller(agencyId: string) {
  const user: SessionUser = { id: crypto.randomUUID(), email: "o@test.local", name: "O", agencyId, role: "owner" };
  return appRouter.createCaller({ db, user } as TrpcContext);
}

/** Агентство с одним клиентом категории и одним живым ответом, цитирующим домены. */
async function agencyWithAnswer(clientDomain: string, cited: string[]) {
  const agency = await createAgency(db, { name: `Index ${clientDomain}`, clientLimit: 10 });
  agencies.push(agency.id);
  const client = await createClient(db, {
    agencyId: agency.id,
    name: clientDomain,
    domain: clientDomain,
    category: CATEGORY,
    brandNames: [clientDomain],
    competitorNames: [],
  });
  const cluster = await createPromptCluster(db, { clientId: client.id, name: "c" });
  const prompt = await createPrompt(db, { clusterId: cluster.id, text: "best booking tool" });
  const run = await createRun(db, { clientId: client.id, status: "done", trigger: "manual", adaptersMode: "live" });
  const response = await createResponse(db, {
    runId: run.id,
    promptId: prompt.id,
    platform: "perplexity",
    modelVersion: "test",
    rawText: "answer",
    costUsd: "0.001",
  });
  await db.insert(citations).values(cited.map((domain, i) => ({ responseId: response.id, url: `https://${domain}/`, domain, position: i + 1 })));
  return { agencyId: agency.id, clientId: client.id };
}

describe("clients.categoryIndex", () => {
  it("меньше трёх агентств — индекса нет", async () => {
    const a = await agencyWithAnswer("alpha-cal.test", ["reviews.test"]);
    await agencyWithAnswer("beta-cal.test", ["reviews.test"]);

    const index = await caller(a.agencyId).clients.categoryIndex({ id: a.clientId });
    expect(index.workspaces).toBe(2);
    expect(index.top).toEqual([]);
  });

  it("от трёх агентств — общие источники, без доменов клиентов категории", async () => {
    const a = await agencyWithAnswer("alpha-cal.test", ["reviews.test", "beta-cal.test"]);
    await agencyWithAnswer("beta-cal.test", ["reviews.test", "docs.alpha-cal.test"]);
    await agencyWithAnswer("gamma-cal.test", ["forum.test"]);

    const index = await caller(a.agencyId).clients.categoryIndex({ id: a.clientId });
    expect(index.workspaces).toBe(3);
    expect(index.top).toEqual([
      { domain: "reviews.test", answers: 2 },
      { domain: "forum.test", answers: 1 },
    ]);
  });

  it("чужой клиент — NOT_FOUND", async () => {
    const a = await agencyWithAnswer("alpha-cal.test", ["reviews.test"]);
    const other = await agencyWithAnswer("beta-cal.test", ["reviews.test"]);

    await expect(caller(other.agencyId).clients.categoryIndex({ id: a.clientId })).rejects.toSatisfy(
      (error: unknown) => error instanceof TRPCError && error.code === "NOT_FOUND",
    );
  });
});
