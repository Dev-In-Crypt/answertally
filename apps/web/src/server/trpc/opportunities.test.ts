import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { detectedOpportunitySchema, scoreOpportunity } from "@repo/core";
import { completeRun } from "@repo/pipeline";
import {
  createAgency,
  createClient,
  createDb,
  createRun,
  createUser,
  deleteAgency,
  listActions,
  listOpportunities,
} from "@repo/db";
import { promptClusters, prompts, runSchedules } from "@repo/db/schema/measurement";
import { appRouter } from "./root";
import type { SessionUser, TrpcContext } from "./context";

/**
 * Verify: API возможностей.
 *
 * Проверяется не «работает ли список», а три вещи, за которые продукт
 * отвечает: чужое остаётся невидимым, перенос в работу тащит с собой весь
 * контекст, и отклонить без объяснения нельзя.
 */

const { db, close } = createDb();

afterAll(async () => {
  await close();
});

function caller(userId: string, agencyId: string, role: SessionUser["role"] = "owner") {
  const user: SessionUser = {
    id: userId,
    email: "owner@opportunities.test",
    name: "Owner",
    agencyId,
    role,
  };
  return appRouter.createCaller({ db, user } as TrpcContext);
}

describe("opportunities", () => {
  let agencyId = "";
  let userId = "";
  let clientId = "";

  beforeAll(async () => {
    const agency = await createAgency(db, { name: "Opportunity API Agency", clientLimit: 10 });
    agencyId = agency.id;

    const user = await createUser(db, {
      agencyId,
      email: `owner-${crypto.randomUUID()}@opportunities.test`,
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
        .values({ clientId, platforms: ["chatgpt", "perplexity", "ai-overviews"], samplesPerPrompt: 3 })
        .returning()
    )[0]!.id;

    const runId = (await createRun(db, { clientId, scheduleId, trigger: "manual" })).id;
    await completeRun(db, runId, clientId, "mock");
  });

  afterAll(async () => {
    await deleteAgency(db, agencyId);
  });

  it("отдаёт возможности со своим приоритетом и уровнем доказательности", async () => {
    const found = await caller(userId, agencyId).opportunities.list({ clientId });

    expect(found.length).toBeGreaterThan(0);
    for (const item of found) {
      expect(["low", "medium", "high"]).toContain(item.priority);
      expect(["low", "medium", "high"]).toContain(item.evidenceLevel);
      expect(item.reason.length).toBeGreaterThan(0);
    }
    // Список приходит отсортированным: агентство читает его сверху вниз.
    expect(found.map((item) => item.score)).toEqual(
      [...found.map((item) => item.score)].sort((a, b) => b - a),
    );
  });

  it("возможности чужого агентства не существует", async () => {
    const other = await createAgency(db, { name: "Someone Else", clientLimit: 3 });

    try {
      const [first] = await listOpportunities(db, clientId);
      expect(first).toBeDefined();

      // NOT_FOUND, а не FORBIDDEN: существование чужого ресурса не раскрывается.
      await expect(caller(userId, other.id).opportunities.get({ id: first!.id })).rejects.toThrow(
        TRPCError,
      );
      await expect(
        caller(userId, other.id).opportunities.list({ clientId }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    } finally {
      await deleteAgency(db, other.id);
    }
  });

  it("объясняет оценку разбором, а не одним числом", async () => {
    const [first] = await caller(userId, agencyId).opportunities.list({ clientId });
    const detail = await caller(userId, agencyId).opportunities.get({ id: first!.id });

    const breakdown = detail.scoreBreakdown as unknown as ReturnType<typeof scoreOpportunity>;
    expect(breakdown.factors.impact).toBeGreaterThanOrEqual(0);
    expect(breakdown.weights).toBeDefined();
    // Пересчёт по сохранённым входам обязан дать ту же оценку: иначе разбор
    // объяснял бы не то число, которое стоит на карточке.
    expect(scoreOpportunity(breakdown.inputs).score).toBe(detail.score);
  });

  it("доказательство приходит агрегатом, а отдельные ответы — примерами", async () => {
    const [first] = await caller(userId, agencyId).opportunities.list({ clientId });
    const evidence = await caller(userId, agencyId).opportunities.evidence({ id: first!.id });

    expect(evidence.window.start.getTime()).toBeLessThan(evidence.window.end.getTime());
    expect(evidence.totalResponsesInWindow).toBeGreaterThanOrEqual(evidence.responses.length);
    expect(evidence.basis.length).toBeGreaterThan(0);
  });

  it("перенос в работу тащит причину, источник и темы", async () => {
    const list = await caller(userId, agencyId).opportunities.list({ clientId });
    const detail = await caller(userId, agencyId).opportunities.get({ id: list[0]!.id });
    const recommendation = detectedOpportunitySchema.shape.recommendedActions.parse(
      detail.recommendedActions,
    )[0]!;

    const result = await caller(userId, agencyId).opportunities.convertToAction({
      id: detail.id,
      recommendation,
    });

    expect(result.created).toBe(true);
    expect(result.action.reason).toBe(recommendation.reason);
    expect(result.action.originOpportunityId).toBe(detail.id);
    for (const clusterId of detail.affectedClusterIds) {
      expect(result.action.affectedClusterIds).toContain(clusterId);
    }

    // Повторный перенос не плодит второй задачи с той же причиной.
    const again = await caller(userId, agencyId).opportunities.convertToAction({
      id: detail.id,
      recommendation,
    });
    expect(again.created).toBe(false);
    expect(again.action.id).toBe(result.action.id);

    const actions = await listActions(db, clientId);
    expect(actions.filter((action) => action.originRule === recommendation.rule)).toHaveLength(1);
  });

  it("отклонить без объяснения нельзя", async () => {
    const list = await caller(userId, agencyId).opportunities.list({ clientId });
    const target = list.find((item) => item.status === "open");
    expect(target).toBeDefined();

    // Пункт, исчезнувший без причины, вернётся тем же детектором, и никто не
    // вспомнит, почему его сняли.
    await expect(
      caller(userId, agencyId).opportunities.decide({ id: target!.id, status: "dismissed" }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });

    const decided = await caller(userId, agencyId).opportunities.decide({
      id: target!.id,
      status: "dismissed",
      dismissedReason: "Client will not work with review platforms this quarter",
    });
    expect(decided?.status).toBe("dismissed");
  });

  it("пересчёт по кнопке не запускается чаще, чем меняются данные", async () => {
    const first = await caller(userId, agencyId).opportunities.refresh({ clientId });
    const second = await caller(userId, agencyId).opportunities.refresh({ clientId });

    // Первый мог пройти или тоже упереться в порог — важно, что второй подряд
    // не считает заново: данные меняются прогонами, а не нажатиями.
    expect(second.throttled).toBe(true);
    expect(typeof first.detected).toBe("number");
  });
});
