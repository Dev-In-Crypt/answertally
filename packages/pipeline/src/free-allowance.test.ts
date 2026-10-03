import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { FREE_CHECK_ALLOWANCE } from "@repo/core";
import { createAgency, createClient, createDb, createRun, deleteAgency, incrementAiChecks } from "@repo/db";
import { measurementAllowedForAgency } from "./entitlements";

/**
 * Бесплатный аудит — один на аккаунт, а не один в месяц.
 *
 * Счётчик ведётся по месяцам ради счёта плательщику. Бесплатная граница
 * сверялась с месячной строкой, и первого числа каждый бесплатный аккаунт
 * получал новый аудит — бессрочно.
 */

const { db, close } = createDb();

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

  afterAll(async () => {
    await close();
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
