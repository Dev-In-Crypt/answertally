import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { billingPeriod, MockAdapter, registerLiveAdapter } from "@repo/core";
import {
  createAgency,
  createClient,
  createDb,
  createRun,
  deleteAgency,
  getUsageCounter,
  incrementAiChecks,
} from "@repo/db";
import { promptClusters, prompts, runSchedules } from "@repo/db/schema/measurement";
import { orchestrateRun } from "./run-orchestration";
import { makePaying } from "./test-support";

/** Verify T20: прогон из T17 (18 ответов) увеличивает счётчик ровно на 18. */

const { db, close } = createDb();

/**
 * Подставной живой адаптер: та же реализация, что у заглушек.
 *
 * Нужен, чтобы пройти ветку живого режима, не уходя в сеть и не тратя
 * ключей. Тесты никогда не ходят наружу — это правило проекта.
 */
for (const platform of ["chatgpt", "perplexity", "grok"] as const) {
  registerLiveAdapter(platform, () => new MockAdapter(platform));
}

describe("usage counters", () => {
  let agencyId = "";
  let runId = "";

  beforeEach(async () => {
    const agency = await createAgency(db, { name: "Usage Agency", clientLimit: 10 });
    // Growth: на нём Grok разрешён, а тест — про его вес в 5 проверок.
    await makePaying(db, agency.id, "growth");
    agencyId = agency.id;

    const client = await createClient(db, {
      agencyId,
      name: "AcmeCRM",
      domain: "acmecrm.test",
      brandNames: ["AcmeCRM"],
      competitorNames: ["Northstack"],
    });

    const clusterId = (
      await db
        .insert(promptClusters)
        .values({ clientId: client.id, name: "c", intent: "comparison" })
        .returning()
    )[0]!.id;

    await db.insert(prompts).values([
      { clusterId, text: "best CRM for startups" },
      { clusterId, text: "Northstack alternatives" },
    ]);

    const scheduleId = (
      await db
        .insert(runSchedules)
        .values({
          clientId: client.id,
          platforms: ["chatgpt", "perplexity", "grok"],
          samplesPerPrompt: 3,
        })
        .returning()
    )[0]!.id;

    runId = (await createRun(db, { clientId: client.id, scheduleId, trigger: "manual" })).id;
  });

  afterEach(async () => {
    await deleteAgency(db, agencyId);
  });

  afterAll(async () => {
    await close();
  });

  it("живой прогон на 18 ответов списывает 42 проверки: ответ Grok весит 5", async () => {
    // Живой режим с подставным адаптером: в сеть тест не ходит, но проходит
    // ровно ту ветку, по которой расход и считается.
    await orchestrateRun(db, runId, "live");

    const counter = await getUsageCounter(db, agencyId, billingPeriod());
    // 2 вопроса × 3 сэмпла × (ChatGPT 1 + Perplexity 1 + Grok 5).
    expect(counter?.aiChecksUsed).toBe(42);
  });

  it("прогон на заглушках в расход не идёт", async () => {
    // Ассистента никто не спрашивал и денег он не стоил: записать такой
    // прогон в израсходованные проверки значит выставить счёт за то, чего
    // не было. Экран расхода это и так утверждает отдельной строкой.
    await orchestrateRun(db, runId, "mock");

    expect(await getUsageCounter(db, agencyId, billingPeriod())).toBeUndefined();
  });

  it("инкремент атомарен при параллельных вызовах", async () => {
    const period = billingPeriod();
    // Job'ы платформ выполняются параллельно и пишут в одну строку:
    // без атомарного инкремента часть расхода терялась бы.
    await Promise.all(Array.from({ length: 20 }, () => incrementAiChecks(db, agencyId, period)));

    expect((await getUsageCounter(db, agencyId, period))?.aiChecksUsed).toBe(20);
  });

  it("расход разных периодов не смешивается", async () => {
    await incrementAiChecks(db, agencyId, "2026-07", 5);
    await incrementAiChecks(db, agencyId, "2026-08", 3);

    expect((await getUsageCounter(db, agencyId, "2026-07"))?.aiChecksUsed).toBe(5);
    expect((await getUsageCounter(db, agencyId, "2026-08"))?.aiChecksUsed).toBe(3);
  });

  it("расход одного агентства не попадает другому", async () => {
    const other = await createAgency(db, { name: "Other Agency" });
    await orchestrateRun(db, runId, "mock");

    expect(await getUsageCounter(db, other.id, billingPeriod())).toBeUndefined();
    await deleteAgency(db, other.id);
  });
});
