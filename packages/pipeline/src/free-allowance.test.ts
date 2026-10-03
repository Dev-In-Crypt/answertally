import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { billingPeriod, FREE_CHECK_ALLOWANCE, PLAN_LIMITS } from "@repo/core";
import {
  createAgency,
  createClient,
  createDb,
  createRun,
  deleteAgency,
  finishRun,
  incrementAiChecks,
  listRunsByClient,
} from "@repo/db";
import { measurementAllowedForAgency, startRunIfAllowed } from "./entitlements";
import { makePaying } from "./test-support";

/**
 * Бесплатный аудит — один на аккаунт, а не один в месяц.
 *
 * Счётчик ведётся по месяцам ради счёта плательщику. Бесплатная граница
 * сверялась с месячной строкой, и первого числа каждый бесплатный аккаунт
 * получал новый аудит — бессрочно.
 */

const { db, close } = createDb();

afterAll(async () => {
  await close();
});

describe("бесплатная граница", () => {
  let agencyId = "";
  let clientId = "";

  beforeEach(async () => {
    agencyId = (await createAgency(db, { name: "Free Agency", clientLimit: 3 })).id;
    clientId = (await createClient(db, { agencyId, name: "Free Client", domain: "free.test" })).id;
  });

  afterEach(async () => {
    await deleteAgency(db, agencyId);
  });

  it("расход прошлого месяца засчитывается в этом", async () => {
    // Аудит прошёл в сентябре; в октябре нового быть не должно.
    await incrementAiChecks(db, agencyId, "2026-09", FREE_CHECK_ALLOWANCE);

    const decision = await measurementAllowedForAgency(db, agencyId, {
      trigger: "manual",
      checksPlanned: 144,
    });

    expect(decision.allowed).toBe(false);
  });

  it("расход складывается по всем месяцам", async () => {
    // По отдельности каждый месяц укладывался бы в лимит.
    await incrementAiChecks(db, agencyId, "2026-08", 100);
    await incrementAiChecks(db, agencyId, "2026-09", 40);

    const decision = await measurementAllowedForAgency(db, agencyId, {
      trigger: "manual",
      checksPlanned: 144,
    });

    expect(decision.allowed).toBe(false);
  });

  it("второй прогон не стартует, пока идёт первый", async () => {
    await createRun(db, { clientId, scheduleId: null, trigger: "manual", adaptersMode: "live" });

    const decision = await measurementAllowedForAgency(db, agencyId, {
      trigger: "manual",
      checksPlanned: 144,
    });

    expect(decision.allowed).toBe(false);
    expect(decision.message).toMatch(/still running/i);
  });

  it("свежему аккаунту аудит разрешён", async () => {
    const decision = await measurementAllowedForAgency(db, agencyId, {
      trigger: "manual",
      checksPlanned: 144,
    });

    expect(decision.allowed).toBe(true);
  });
});

describe("старт прогона под блокировкой", () => {
  let agencyId = "";
  let clientId = "";
  const live = { scheduleId: null, trigger: "manual" as const, adaptersMode: "live" as const };

  beforeEach(async () => {
    agencyId = (await createAgency(db, { name: "Race Agency", clientLimit: 3 })).id;
    clientId = (await createClient(db, { agencyId, name: "Race Client", domain: "race.test" })).id;
  });

  afterEach(async () => {
    await deleteAgency(db, agencyId);
  });

  it("двадцать одновременных стартов создают один прогон", async () => {
    // Один batch tRPC — двадцать вызовов параллельно. Без блокировки все
    // видели «израсходовано 0, идущих 0», и уходило двадцать аудитов.
    const results = await Promise.all(
      Array.from({ length: 20 }, () => startRunIfAllowed(db, agencyId, { ...live, clientId }, 144)),
    );

    expect(results.filter((r) => r.run).length).toBe(1);
    expect(await listRunsByClient(db, clientId)).toHaveLength(1);
  });

  it("размер прогона записывается в него", async () => {
    const { run } = await startRunIfAllowed(db, agencyId, { ...live, clientId }, 144);
    expect(run?.plannedChecks).toBe(144);
  });

  it("упавший прогон считается израсходованным, хотя счётчик его не видел", async () => {
    // Платные вызовы, упавшие до записи, в счётчик не попадают — а деньги
    // за них ушли. Сумма одобренных прогонов их видит.
    const { run } = await startRunIfAllowed(db, agencyId, { ...live, clientId }, 144);
    await finishRun(db, run!.id, "failed");

    const decision = await measurementAllowedForAgency(db, agencyId, {
      trigger: "manual",
      checksPlanned: 144,
    });
    expect(decision.allowed).toBe(false);
  });

  it("прогоны на заглушках бесплатный остаток не едят", async () => {
    const { run } = await startRunIfAllowed(
      db,
      agencyId,
      { ...live, clientId, adaptersMode: "mock" },
      144,
    );
    await finishRun(db, run!.id, "done");

    const decision = await measurementAllowedForAgency(db, agencyId, {
      trigger: "manual",
      checksPlanned: 144,
    });
    expect(decision.allowed).toBe(true);
  });

  it("плательщик упирается в месячный лимит тарифа", async () => {
    await makePaying(db, agencyId, "starter");
    const allowance = PLAN_LIMITS.starter.aiCheckAllowance;
    await incrementAiChecks(db, agencyId, billingPeriod(), allowance - 100);

    const fits = await measurementAllowedForAgency(db, agencyId, { trigger: "manual", checksPlanned: 100 });
    expect(fits.allowed).toBe(true);

    const over = await measurementAllowedForAgency(db, agencyId, { trigger: "scheduled", checksPlanned: 101 });
    expect(over.allowed).toBe(false);
  });

  it("плательщику прошлый месяц в лимит не идёт", async () => {
    await makePaying(db, agencyId, "starter");
    await incrementAiChecks(db, agencyId, "2000-01", PLAN_LIMITS.starter.aiCheckAllowance);

    const decision = await measurementAllowedForAgency(db, agencyId, { trigger: "manual", checksPlanned: 144 });
    expect(decision.allowed).toBe(true);
  });
});
