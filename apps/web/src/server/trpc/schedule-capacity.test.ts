import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  createAgency,
  upsertSubscription,
  createClient,
  createDb,
  createPrompt,
  createPromptCluster,
  deleteAgency,
} from "@repo/db";
import { DEFAULT_PLATFORMS, isMeasurableAssistant, PLAN_LIMITS, PLATFORM_IDS } from "@repo/core";
import { CADENCES, capabilitiesFor } from "@repo/core/config/measurement";
import { refuseSchedule } from "@repo/core/adapters/capacity";
import { appRouter } from "./root";
import type { SessionUser, TrpcContext, UserRole } from "./context";
import type { Database } from "@repo/db";

/**
 * Ёмкость измерения приходит из конфига, а не из литералов в роутере.
 *
 * Тесты работают на агентстве без подписки, то есть на starter. С момента,
 * когда тарифы развели, это значит: три самых дешёвых ассистента и опрос не
 * чаще раза в неделю. Проверяется и то, что разрешено, и то, что роутер
 * отказывает сам, а не полагается на форму.
 *
 * Требует поднятой БД (docker compose up -d && pnpm db:migrate).
 */

/** Что даёт starter — умолчание для агентства без подписки. */
const STARTER_ASSISTANTS = ["chatgpt", "perplexity", "grok"] as const;
const STARTER_CADENCES = ["biweekly", "weekly"] as const;

const { db, close } = createDb();

function contextFor(user: SessionUser | null): TrpcContext {
  return { db: db as Database, user };
}

function userIn(agencyId: string, role: UserRole = "owner"): SessionUser {
  return { id: crypto.randomUUID(), email: `${role}@test.local`, name: "Test", agencyId, role };
}

describe("ёмкость расписания", () => {
  let agencyId = "";
  let clientId = "";

  beforeAll(async () => {
    const agency = await createAgency(db, { name: "Capacity Agency", clientLimit: 10 });
    /**
     * Подписка нужна, потому что тест говорит про тариф Starter, а до первой
     * оплаты набор другой: бесплатный аудит не включает Grok. Без неё тест
     * проверял бы бесплатный аудит под именем тарифа.
     */
    await upsertSubscription(db, {
      agencyId: agency.id,
      customerId: `cus_${agency.id.slice(0, 8)}`,
      subscriptionId: `sub_${agency.id.slice(0, 8)}`,
      plan: "starter",
      status: "active",
      currentPeriodEnd: new Date("2099-01-01T00:00:00.000Z"),
      cancelAtPeriodEnd: false,
    });
    agencyId = agency.id;

    const client = await createClient(db, {
      agencyId,
      name: "Capacity Client",
      domain: "capacity.test",
    });
    clientId = client.id;

    const cluster = await createPromptCluster(db, {
      clientId,
      name: "CRM comparison",
      intent: "comparison",
    });
    for (const text of ["best crm for startups", "crm with good api", "cheapest crm"]) {
      await createPrompt(db, { clusterId: cluster.id, text, isControl: false });
    }
  });

  afterAll(async () => {
    await deleteAgency(db, agencyId);
    await close();
  });

  it("отдаёт разрешённые частоты и ассистентов, а не свой список", async () => {
    const caller = appRouter.createCaller(contextFor(userIn(agencyId)));
    const capacity = await caller.runs.capacity({ clientId });

    // Агентство без подписки работает на starter — это умолчание продукта.
    expect(capacity.cadences.map((c) => c.id)).toEqual([...STARTER_CADENCES]);
    // Приходят все измеряемые, но дорогие — запертыми: спрятанного
    // ассистента агентство не увидит и не узнает, что он есть. Тот,
    // кого продукт не измеряет, в списке не появляется вовсе.
    expect(capacity.assistants.map((a) => a.id)).toEqual([
      ...PLATFORM_IDS.filter((id) => isMeasurableAssistant(id)),
    ]);
    expect(capacity.assistants.filter((a) => a.allowed).map((a) => a.id)).toEqual([
      ...STARTER_ASSISTANTS,
    ]);
    expect(capacity.monthlyCheckAllowance).toBe(PLAN_LIMITS[capacity.plan].aiCheckAllowance);
    expect(capacity.defaultAssistants).toEqual([...STARTER_ASSISTANTS]);
    expect(capacity.promptsPerClient).toBeNull();
  });

  it("считает активные вопросы клиента — множитель оценки", async () => {
    const caller = appRouter.createCaller(contextFor(userIn(agencyId)));
    const capacity = await caller.runs.capacity({ clientId });

    expect(capacity.promptCount).toBe(3);
  });

  it("цена ответа берётся из кода, а не назначается экраном", async () => {
    const caller = appRouter.createCaller(contextFor(userIn(agencyId)));
    const capacity = await caller.runs.capacity({ clientId });

    expect(capacity.estimatedCostPerAnswerUsd).toBeGreaterThan(0);
  });

  it("чужому клиенту ёмкость не показывается", async () => {
    const other = await createAgency(db, { name: "Other Agency", clientLimit: 10 });
    const caller = appRouter.createCaller(contextFor(userIn(other.id)));

    await expect(caller.runs.capacity({ clientId })).rejects.toSatisfy(
      (error: unknown) => error instanceof TRPCError && error.code === "NOT_FOUND",
      "ожидался TRPCError с кодом NOT_FOUND",
    );

    await deleteAgency(db, other.id);
  });

  it.each([...STARTER_CADENCES])("частота %s сохраняется на starter", async (cadence) => {
    const caller = appRouter.createCaller(contextFor(userIn(agencyId)));

    const saved = await caller.runs.saveSchedule({
      clientId,
      cadence,
      platforms: [...STARTER_ASSISTANTS],
      samplesPerPrompt: 3,
      active: true,
    });

    expect(saved.cadence).toBe(cadence);
  });

  it("ежедневный опрос роутер не сохраняет на starter", async () => {
    // Отказывает сервер, а не форма: расписание можно сохранить и в обход
    // экрана, а частота — сильнейший рычаг расхода.
    const caller = appRouter.createCaller(contextFor(userIn(agencyId)));

    await expect(
      caller.runs.saveSchedule({
        clientId,
        cadence: "daily",
        platforms: [...STARTER_ASSISTANTS],
        samplesPerPrompt: 3,
        active: true,
      }),
    ).rejects.toSatisfy(
      (error: unknown) => error instanceof TRPCError && error.code === "BAD_REQUEST",
      "ожидался TRPCError с кодом BAD_REQUEST",
    );
  });

  it("дорогого ассистента роутер не сохраняет на starter", async () => {
    const caller = appRouter.createCaller(contextFor(userIn(agencyId)));

    await expect(
      caller.runs.saveSchedule({
        clientId,
        cadence: "biweekly",
        platforms: [...STARTER_ASSISTANTS, "claude"],
        samplesPerPrompt: 3,
        active: true,
      }),
    ).rejects.toSatisfy(
      (error: unknown) => error instanceof TRPCError && error.code === "BAD_REQUEST",
      "ожидался TRPCError с кодом BAD_REQUEST",
    );
  });

  it("умолчание расписания осталось biweekly", async () => {
    const caller = appRouter.createCaller(contextFor(userIn(agencyId)));
    const capacity = await caller.runs.capacity({ clientId });

    expect(capacity.cadences[0]?.id).toBe("biweekly");
    expect(capacity.defaultAssistants).toEqual([...STARTER_ASSISTANTS]);
  });

  it("незнакомая частота отвергается входной схемой", async () => {
    const caller = appRouter.createCaller(contextFor(userIn(agencyId)));

    await expect(
      caller.runs.saveSchedule({
        clientId,
        // Значение, которого нет в конфиге: расписание не должно его принять.
        cadence: "hourly" as never,
        platforms: [...DEFAULT_PLATFORMS],
        samplesPerPrompt: 3,
        active: true,
      }),
    ).rejects.toSatisfy(
      (error: unknown) => error instanceof TRPCError && error.code === "BAD_REQUEST",
      "ожидался TRPCError с кодом BAD_REQUEST",
    );
  });

  it("запрет тарифа объясняется словами — та же функция, что и в роутере", () => {
    // Роутер отдаёт message отказа как есть, поэтому проверять текст можно
    // на чистой функции с урезанными возможностями: умолчания при этом целы.
    const refusal = refuseSchedule(
      { ...capabilitiesFor("starter"), cadences: ["biweekly"] },
      { cadence: "daily", assistants: [...DEFAULT_PLATFORMS] },
    );

    expect(refusal?.code).toBe("cadence");
    expect(refusal?.message).toMatch(/not part of this plan/);
    // Подмена возможностей тест не портит: реальный конфиг на месте.
    expect(capabilitiesFor("starter").cadences).toEqual(["biweekly", "weekly"]);
    expect(capabilitiesFor("scale").cadences).toEqual([...CADENCES]);
  });
});
