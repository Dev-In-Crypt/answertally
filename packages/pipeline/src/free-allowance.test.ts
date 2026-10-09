import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { FREE_CHECK_ALLOWANCE, PLAN_LIMITS } from "@repo/core";
import {
  createAgency,
  createClient,
  createDb,
  createPrompt,
  createPromptCluster,
  createResponse,
  createRun,
  deleteAgency,
  finishRun,
  incrementAiChecks,
  listRunsByClient,
} from "@repo/db";
import {
  measurementAllowedForAgency,
  RUN_IN_FLIGHT_MESSAGE,
  startRunIfAllowed,
  usagePeriodForAgency,
} from "./entitlements";
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

  it("второй живой прогон поверх идущего у того же клиента не начинается", async () => {
    // Кнопка после перезагрузки снова активна: второй клик был второй оплатой.
    await makePaying(db, agencyId, "starter");
    const first = await startRunIfAllowed(db, agencyId, { ...live, clientId }, 18);
    const second = await startRunIfAllowed(db, agencyId, { ...live, clientId }, 18);

    expect(first.run).not.toBeNull();
    expect(second.run).toBeNull();
    expect(second.decision.message).toBe(RUN_IN_FLIGHT_MESSAGE);

    // Закончился — следующий можно.
    await finishRun(db, first.run!.id, "done");
    expect((await startRunIfAllowed(db, agencyId, { ...live, clientId }, 18)).run).not.toBeNull();
  });

  it("размер прогона записывается в него", async () => {
    const { run } = await startRunIfAllowed(db, agencyId, { ...live, clientId }, 144);
    expect(run?.plannedChecks).toBe(144);
  });

  it("прогон, упавший до первого ответа, бесплатный аудит не съедает", async () => {
    // Сбой у провайдера или очереди — человек не получил ничего и должен
    // иметь возможность запустить аудит снова.
    const { run } = await startRunIfAllowed(db, agencyId, { ...live, clientId }, 144);
    await finishRun(db, run!.id, "failed");

    const decision = await measurementAllowedForAgency(db, agencyId, {
      trigger: "manual",
      checksPlanned: 144,
    });
    expect(decision.allowed).toBe(true);
  });

  it("идущий прогон держит свою долю, пока не допишет ответы", async () => {
    // Плательщик: правило «один аудит за раз» к нему не относится, и
    // отказ здесь — только от арифметики потолка.
    await makePaying(db, agencyId, "starter");
    const allowance = PLAN_LIMITS.starter.aiCheckAllowance;
    await incrementAiChecks(db, agencyId, await usagePeriodForAgency(db, agencyId), allowance - 150);
    await startRunIfAllowed(db, agencyId, { ...live, clientId }, 100);

    const decision = await measurementAllowedForAgency(db, agencyId, {
      trigger: "manual",
      checksPlanned: 60,
    });
    // 100 обещано идущему прогону, 60 сверху в оставшиеся 150 не помещаются.
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
    await incrementAiChecks(db, agencyId, await usagePeriodForAgency(db, agencyId), allowance - 100);

    const fits = await measurementAllowedForAgency(db, agencyId, {
      trigger: "manual",
      checksPlanned: 100,
    });
    expect(fits.allowed).toBe(true);

    const over = await measurementAllowedForAgency(db, agencyId, {
      trigger: "scheduled",
      checksPlanned: 101,
    });
    expect(over.allowed).toBe(false);
  });

  it("плательщику прошлый месяц в лимит не идёт", async () => {
    await makePaying(db, agencyId, "starter");
    await incrementAiChecks(db, agencyId, "2000-01", PLAN_LIMITS.starter.aiCheckAllowance);

    const decision = await measurementAllowedForAgency(db, agencyId, {
      trigger: "manual",
      checksPlanned: 144,
    });
    expect(decision.allowed).toBe(true);
  });
});

describe("один бесплатный аудит на сайт", () => {
  const agencies: string[] = [];

  afterEach(async () => {
    for (const id of agencies.splice(0)) {
      await deleteAgency(db, id);
    }
  });

  async function agencyWithClient(domain: string) {
    const agencyId = (await createAgency(db, { name: "Farm Agency", clientLimit: 3 })).id;
    agencies.push(agencyId);
    const clientId = (await createClient(db, { agencyId, name: "Brand", domain })).id;
    return { agencyId, clientId };
  }

  /** Аудит, давший хотя бы один ответ. */
  async function auditedWithAnswer(agencyId: string, clientId: string) {
    const values = { scheduleId: null, trigger: "manual" as const, adaptersMode: "live" as const };
    const { run } = await startRunIfAllowed(db, agencyId, { ...values, clientId }, 144);
    const cluster = await createPromptCluster(db, { clientId, name: "C", intent: "other" });
    const prompt = await createPrompt(db, { clusterId: cluster.id, text: "best CRM" });
    await createResponse(db, {
      runId: run!.id,
      promptId: prompt.id,
      platform: "chatgpt",
      modelVersion: "test",
      sampleIndex: 0,
      rawText: "answer",
      latencyMs: 1,
      costUsd: "0.01",
    });
  }

  it("тот же домен в другом бесплатном аккаунте аудита не получает", async () => {
    // Десять аккаунтов на один сайт — это десять аудитов одного и того же.
    const domain = `farm-${crypto.randomUUID().slice(0, 8)}.test`;
    const first = await agencyWithClient(domain);
    const second = await agencyWithClient(domain);
    const values = { scheduleId: null, trigger: "manual" as const, adaptersMode: "live" as const };

    await auditedWithAnswer(first.agencyId, first.clientId);

    const refused = await startRunIfAllowed(
      db,
      second.agencyId,
      { ...values, clientId: second.clientId },
      144,
    );
    expect(refused.run).toBeNull();
    expect(refused.decision.message).toContain(domain);
    // Текст не выдаёт, что бренд есть у кого-то ещё на платформе.
    expect(refused.decision.message).not.toMatch(/workspace/i);
  });

  it("аудит, не давший ответов, домен не занимает", async () => {
    const domain = `farm-${crypto.randomUUID().slice(0, 8)}.test`;
    const first = await agencyWithClient(domain);
    const second = await agencyWithClient(domain);
    const values = { scheduleId: null, trigger: "manual" as const, adaptersMode: "live" as const };

    await startRunIfAllowed(db, first.agencyId, { ...values, clientId: first.clientId }, 144);
    const allowed = await startRunIfAllowed(
      db,
      second.agencyId,
      { ...values, clientId: second.clientId },
      144,
    );
    expect(allowed.run).not.toBeNull();
  });

  it("платящему тот же домен измерять можно", async () => {
    const domain = `farm-${crypto.randomUUID().slice(0, 8)}.test`;
    const first = await agencyWithClient(domain);
    const second = await agencyWithClient(domain);
    await makePaying(db, second.agencyId);
    const values = { scheduleId: null, trigger: "manual" as const, adaptersMode: "live" as const };

    await startRunIfAllowed(db, first.agencyId, { ...values, clientId: first.clientId }, 144);
    const allowed = await startRunIfAllowed(
      db,
      second.agencyId,
      { ...values, clientId: second.clientId },
      144,
    );
    expect(allowed.run).not.toBeNull();
  });
});
