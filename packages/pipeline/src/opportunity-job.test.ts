import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { REOPEN_DELTA_POINTS } from "@repo/core";
import {
  createAgency,
  createClient,
  createDb,
  createRun,
  deleteAgency,
  listOpportunities,
  setOpportunityDecision,
} from "@repo/db";
import { opportunities } from "@repo/db/schema/opportunities";
import { promptClusters, prompts, runSchedules } from "@repo/db/schema/measurement";
import { sources } from "@repo/db/schema/sources";
import { completeRun } from "./complete-run";
import { generateOpportunities } from "./opportunity-job";

/**
 * Verify: пересчёт возможностей.
 *
 * Главное свойство здесь одно, и оно не про находки: повторный пересчёт не
 * имеет права трогать то, что решил человек. Если ночной прогон вернёт всё,
 * что агентство вчера отклонило, функция станет вреднее своего отсутствия.
 */

const { db, close } = createDb();

describe("пересчёт возможностей", () => {
  let agencyId = "";
  let clientId = "";

  beforeEach(async () => {
    await db.delete(sources);

    const agency = await createAgency(db, { name: "Opportunity Agency", clientLimit: 10 });
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

    await db.insert(prompts).values([
      { clusterId, text: "best CRM for startups" },
      { clusterId, text: "easiest CRM for a small sales team" },
    ]);

    const scheduleId = (
      await db
        .insert(runSchedules)
        .values({ clientId, platforms: ["chatgpt", "perplexity", "grok"], samplesPerPrompt: 3 })
        .returning()
    )[0]!.id;

    const runId = (await createRun(db, { clientId, scheduleId, trigger: "manual" })).id;
    await completeRun(db, runId, clientId, "mock");
  });

  afterEach(async () => {
    await deleteAgency(db, agencyId);
  });

  afterAll(async () => {
    await close();
  });

  it("находит возможности по завершённому прогону", async () => {
    const found = await listOpportunities(db, clientId);

    expect(found.length).toBeGreaterThan(0);
    for (const item of found) {
      expect(item.reason.trim().length).toBeGreaterThan(0);
      expect(item.score).toBeGreaterThanOrEqual(0);
      expect(item.score).toBeLessThanOrEqual(100);
      expect(item.recommendedActions.length).toBeGreaterThan(0);
    }
  });

  it("повторный пересчёт не плодит строк и не сбрасывает дату первой находки", async () => {
    const before = await listOpportunities(db, clientId);
    const firstSeen = new Map(before.map((row) => [row.dedupeKey, row.firstDetectedAt.getTime()]));

    await generateOpportunities(db, clientId);
    const after = await listOpportunities(db, clientId);

    expect(after.map((row) => row.dedupeKey).sort()).toEqual(
      before.map((row) => row.dedupeKey).sort(),
    );
    for (const row of after) {
      // «Этот разрыв открыт с марта» — фраза, которую агентство говорит своему
      // клиенту. Пересчёт не имеет права её обнулять.
      expect(row.firstDetectedAt.getTime()).toBe(firstSeen.get(row.dedupeKey));
    }
  });

  it("отклонённая возможность остаётся отклонённой после пересчёта", async () => {
    const [first] = await listOpportunities(db, clientId);
    expect(first).toBeDefined();

    await setOpportunityDecision(db, first!.id, {
      status: "dismissed",
      dismissedReason: "The client will not pursue review sites this quarter",
      decisionScore: first!.score,
    });

    await generateOpportunities(db, clientId);

    const reloaded = (await listOpportunities(db, clientId)).find((row) => row.id === first!.id);
    expect(reloaded?.status).toBe("dismissed");
    expect(reloaded?.dismissedReason).toContain("review sites");
  });

  it("отклонённая возвращается, когда заметно выросла", async () => {
    const [first] = await listOpportunities(db, clientId);
    expect(first).toBeDefined();

    // Решение принималось при заметно меньшей оценке: с тех пор разрыв вырос.
    await setOpportunityDecision(db, first!.id, {
      status: "dismissed",
      dismissedReason: "Too small to bother with",
      decisionScore: first!.score - REOPEN_DELTA_POINTS,
    });

    await generateOpportunities(db, clientId);

    const reloaded = (await listOpportunities(db, clientId)).find((row) => row.id === first!.id);
    expect(reloaded?.status).toBe("open");
    expect(reloaded?.decisionScore).toBeNull();
  });

  it("исчезнувшая возможность закрывается, а не удаляется", async () => {
    const [first] = await listOpportunities(db, clientId);
    expect(first).toBeDefined();

    // Подменяем ключ на такой, какого детекторы никогда не выдадут: следующий
    // пересчёт обязан признать строку закрытой, но сохранить её.
    await db
      .update(opportunities)
      .set({ dedupeKey: "source_gap:domain:vanished.example" })
      .where(eq(opportunities.id, first!.id));

    await generateOpportunities(db, clientId);

    const kept = await db.select().from(opportunities).where(eq(opportunities.id, first!.id));
    expect(kept).toHaveLength(1);
    expect(kept[0]?.resolvedAt).not.toBeNull();

    // В обычный список закрытые не попадают.
    const open = await listOpportunities(db, clientId);
    expect(open.some((row) => row.id === first!.id)).toBe(false);
  });

  it("замораживает окно измерения вместе с оценкой", async () => {
    // Без этого доказательство считалось бы по сегодняшнему скользящему окну,
    // то есть по другим данным, чем те, что дали оценку.
    for (const row of await listOpportunities(db, clientId)) {
      expect(row.windowStart.getTime()).toBeLessThan(row.windowEnd.getTime());
      expect(row.sampleCount).toBeGreaterThan(0);
    }
  });

  it("контрольные вопросы не порождают работу: их не трогают нарочно", async () => {
    // Все вопросы клиента — контрольные: сравнивать будет не с чем, если
    // по ним что-то сделать, поэтому и советовать по ним нечего.
    const clientPrompts = await db
      .select({ id: prompts.id })
      .from(prompts)
      .innerJoin(promptClusters, eq(prompts.clusterId, promptClusters.id))
      .where(eq(promptClusters.clientId, clientId));
    for (const prompt of clientPrompts) {
      await db.update(prompts).set({ isControl: true }).where(eq(prompts.id, prompt.id));
    }

    await generateOpportunities(db, clientId);

    const open = (await listOpportunities(db, clientId)).filter((item) => item.status === "open");
    expect(open).toHaveLength(0);
  });

  it("у клиента без измерений ничего не выдумывает", async () => {
    const empty = await createClient(db, {
      agencyId,
      name: "Nothing Measured",
      domain: "nothing.test",
      brandNames: ["Nothing"],
      competitorNames: ["Rival"],
    });

    const outcome = await generateOpportunities(db, empty.id);

    expect(outcome.skipped).toBe("no-prompts");
    expect(await listOpportunities(db, empty.id)).toEqual([]);
  });
});
