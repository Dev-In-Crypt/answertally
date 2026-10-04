import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { TRPCError } from "@trpc/server";
import {
  createAgency,
  createClient,
  createDb,
  createPrompt,
  createPromptCluster,
  deleteAgency,
  getScheduleForClient,
  upsertSubscription,
} from "@repo/db";
import type { Database } from "@repo/db";
import type * as CapacityModule from "@repo/core/adapters/capacity";
import { capabilitiesForAgency } from "@repo/core/config/measurement";
import type { PlanId } from "@repo/core";
import type { SessionUser, TrpcContext } from "./context";

/**
 * Проводка роутера к политике тарифа.
 *
 * Сегодняшний конфиг разрешает всё, и настоящий `refuseSchedule` не
 * может отказать: из-за этого проверку в `saveSchedule` можно было вырезать
 * целиком, и ни один тест бы не упал. Менять умолчания нельзя, поэтому здесь
 * подменяется только сама функция отказа — проверяется не политика (её
 * закрепляет `capacity.test.ts` в @repo/core), а то, что роутер её зовёт с
 * правами агентства и составом из входа и доносит её ответ до человека.
 *
 * Требует поднятой БД (docker compose up -d && pnpm db:migrate).
 */

const refuseSchedule = vi.hoisted(() =>
  vi.fn<(capabilities: unknown, request: unknown) => { code: string; message: string } | null>(),
);

vi.mock("@repo/core/adapters/capacity", async (importOriginal) => {
  const actual = await importOriginal<typeof CapacityModule>();
  // Подменяется ровно одна функция: список частот, оценка и ёмкость формы
  // остаются настоящими, иначе тест перестал бы говорить о живом экране.
  return { ...actual, refuseSchedule };
});

const { appRouter } = await import("./root");
const { db, close } = createDb();

const PROMPT_COUNT = 3;

function caller(agencyId: string) {
  const user: SessionUser = {
    id: crypto.randomUUID(),
    email: "owner@test.local",
    name: "Test",
    agencyId,
    role: "owner",
  };
  return appRouter.createCaller({ db: db as Database, user } satisfies TrpcContext);
}

describe("роутер расписания и отказ тарифа", () => {
  let agencyId = "";
  let clientId = "";
  let plan: PlanId = "starter";

  beforeAll(async () => {
    const agency = await createAgency(db, { name: "Refusal Agency", clientLimit: 10 });
    agencyId = agency.id;
    // Расписание — платная часть: без подписки роутер откажет раньше политики.
    await upsertSubscription(db, {
      agencyId,
      customerId: `cus_${agencyId.slice(0, 8)}`,
      subscriptionId: `sub_${agencyId.slice(0, 8)}`,
      plan: "starter",
      status: "active",
      currentPeriodEnd: new Date("2099-01-01T00:00:00.000Z"),
      cancelAtPeriodEnd: false,
    });

    const client = await createClient(db, {
      agencyId,
      name: "Refusal Client",
      domain: "refusal.test",
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

    // Тариф не зашивается в тест: его называет тот же роутер, что и форма.
    plan = (await caller(agencyId).runs.capacity({ clientId })).plan;
  });

  afterAll(async () => {
    await deleteAgency(db, agencyId);
    await close();
  });

  beforeEach(() => {
    refuseSchedule.mockReset();
    refuseSchedule.mockReturnValue(null);
  });

  it("спрашивает политику о тарифе агентства и о составе из входа", async () => {
    await caller(agencyId).runs.saveSchedule({
      clientId,
      cadence: "biweekly",
      platforms: ["chatgpt", "perplexity"],
      samplesPerPrompt: 3,
      active: true,
    });

    expect(refuseSchedule).toHaveBeenCalledTimes(1);
    expect(refuseSchedule).toHaveBeenCalledWith(capabilitiesForAgency({ plan, paying: true }), {
      cadence: "biweekly",
      assistants: ["chatgpt", "perplexity"],
      // Количество вопросов роутер считает сам — форма его не присылает.
      promptCount: PROMPT_COUNT,
    });
  });

  it("непустой отказ становится BAD_REQUEST с тем же текстом", async () => {
    const message = "Daily checks are not part of this plan. It runs every two weeks.";
    refuseSchedule.mockReturnValue({ code: "cadence", message });

    const error = await caller(agencyId)
      .runs.saveSchedule({
        clientId,
        cadence: "daily",
        platforms: ["chatgpt"],
        samplesPerPrompt: 3,
        active: true,
      })
      .then(() => null)
      .catch((thrown: unknown) => thrown);

    expect(error).toBeInstanceOf(TRPCError);
    expect((error as TRPCError).code).toBe("BAD_REQUEST");
    // Текст не переписывается: объяснение пишет политика, роутер его несёт.
    expect((error as TRPCError).message).toBe(message);
  });

  it("при отказе расписание не меняется", async () => {
    await caller(agencyId).runs.saveSchedule({
      clientId,
      cadence: "biweekly",
      platforms: ["chatgpt"],
      samplesPerPrompt: 3,
      active: true,
    });
    const before = await getScheduleForClient(db, clientId);
    expect(before).toBeDefined();

    refuseSchedule.mockReturnValue({ code: "assistant", message: "Gemini is not in plan." });

    await expect(
      caller(agencyId).runs.saveSchedule({
        clientId,
        cadence: "biweekly",
        platforms: ["gemini"],
        samplesPerPrompt: 10,
        active: true,
      }),
    ).rejects.toBeInstanceOf(TRPCError);

    const after = await getScheduleForClient(db, clientId);

    expect(after?.cadence).toBe(before?.cadence);
    expect(after?.platforms).toEqual(before?.platforms);
    expect(after?.samplesPerPrompt).toBe(before?.samplesPerPrompt);
    expect(after?.active).toBe(before?.active);
  });

  it("пауза проходит и после понижения тарифа — политика её не проверяет", async () => {
    // Иначе расписание, ставшее «не по тарифу», нельзя было бы даже остановить.
    refuseSchedule.mockReturnValue({ code: "cadence", message: "Daily is not in plan." });

    await caller(agencyId).runs.saveSchedule({
      clientId,
      cadence: "daily",
      platforms: ["chatgpt"],
      samplesPerPrompt: 3,
      active: false,
    });

    expect(refuseSchedule).not.toHaveBeenCalled();
    expect((await getScheduleForClient(db, clientId))?.active).toBe(false);
  });

  it("бесплатный аккаунт не сохраняет расписание, которое никогда не запустится", async () => {
    // Воркер отказывает каждому сроку без оплаты, а форма говорила «Saved».
    const free = await createAgency(db, { name: "Free Schedule Agency", clientLimit: 3 });
    try {
      const client = await createClient(db, {
        agencyId: free.id,
        name: "Free Client",
        domain: "free-schedule.test",
      });
      await expect(
        caller(free.id).runs.saveSchedule({
          clientId: client.id,
          cadence: "biweekly",
          platforms: ["chatgpt"],
          samplesPerPrompt: 3,
          active: true,
        }),
      ).rejects.toThrow(/Settings → Billing/);
      expect(await getScheduleForClient(db, client.id)).toBeUndefined();
    } finally {
      await deleteAgency(db, free.id);
    }
  });
});
