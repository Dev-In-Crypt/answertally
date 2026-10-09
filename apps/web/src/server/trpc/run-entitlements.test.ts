import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { allowancePeriod, billingPeriod, FREE_CHECK_ALLOWANCE } from "@repo/core";
import {
  createAgency,
  createClient,
  createDb,
  createPrompt,
  createPromptCluster,
  deleteAgency,
  incrementAiChecks,
  upsertSubscription,
} from "@repo/db";
import { appRouter } from "./root";
import type { SessionUser, TrpcContext } from "./context";
import type { Database } from "@repo/db";

/**
 * Прогон стоит денег, и начинать его может только действующее агентство.
 *
 * Заведение клиента проверку подписки уже проходило, запуск измерения — нет:
 * отменившееся агентство продолжало бы тратить наши деньги на вызовы
 * ассистентов. Здесь проверяются обе стороны: отменённое останавливается, а
 * просрочка платежа в пределах отсрочки — нет (у карты кончился срок, это не
 * отказ от продукта).
 *
 * Требует поднятой БД (docker compose up -d && pnpm db:migrate).
 */

const { db, close } = createDb();

afterAll(async () => {
  await close();
});

function caller(agencyId: string) {
  const user: SessionUser = {
    id: crypto.randomUUID(),
    email: "owner@test.local",
    name: "Owner",
    agencyId,
    role: "owner",
  };
  return appRouter.createCaller({ db: db as Database, user } as TrpcContext);
}

const DAY = 86_400_000;

async function subscribe(
  agencyId: string,
  status: "active" | "past_due" | "canceled" | "incomplete",
  currentPeriodEnd: Date | null,
): Promise<void> {
  await upsertSubscription(db, {
    agencyId,
    customerId: `cus_${crypto.randomUUID().slice(0, 8)}`,
    subscriptionId: "sub_runs",
    plan: "growth",
    status,
    currentPeriodEnd,
    cancelAtPeriodEnd: false,
  });
}

describe("запуск измерения и подписка", () => {
  let agencyId = "";
  let clientId = "";

  beforeEach(async () => {
    const agency = await createAgency(db, { name: "Runs Agency", clientLimit: 10 });
    agencyId = agency.id;

    const client = await createClient(db, {
      agencyId,
      name: "Runs Client",
      domain: "runs.test",
    });
    clientId = client.id;

    const cluster = await createPromptCluster(db, {
      clientId,
      name: "CRM comparison",
      intent: "comparison",
    });
    await createPrompt(db, {
      clusterId: cluster.id,
      text: "best crm for startups",
      isControl: false,
    });
  });

  afterEach(async () => {
    await deleteAgency(db, agencyId);
  });

  it("агентство без подписки измеряет: starter по умолчанию", async () => {
    const result = await caller(agencyId).runs.triggerManual({ clientId });
    expect(result.runId).toBeTruthy();
  });

  it("действующая подписка измеряет", async () => {
    await subscribe(agencyId, "active", new Date(Date.now() + 30 * DAY));

    const result = await caller(agencyId).runs.triggerManual({ clientId });
    expect(result.runId).toBeTruthy();
  });

  it("отменённая подписка не запускает ручной прогон", async () => {
    await subscribe(agencyId, "canceled", new Date(Date.now() - DAY));

    await expect(caller(agencyId).runs.triggerManual({ clientId })).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof TRPCError &&
        error.code === "FORBIDDEN" &&
        error.message.length > 0,
      "ожидался FORBIDDEN с объяснением",
    );
  });

  it("отменённая подписка не запускает и разовый аудит", async () => {
    await subscribe(agencyId, "canceled", new Date(Date.now() - DAY));

    await expect(caller(agencyId).runs.startAudit({ clientId })).rejects.toSatisfy(
      (error: unknown) => error instanceof TRPCError && error.code === "FORBIDDEN",
      "ожидался FORBIDDEN",
    );
  });

  it("незавершённая оплата тоже не даёт тратить деньги", async () => {
    await subscribe(agencyId, "incomplete", null);

    await expect(caller(agencyId).runs.triggerManual({ clientId })).rejects.toSatisfy(
      (error: unknown) => error instanceof TRPCError && error.code === "FORBIDDEN",
      "ожидался FORBIDDEN",
    );
  });

  it("просрочка платежа в пределах отсрочки измерение не останавливает", async () => {
    // Период закончился вчера: отсрочка (14 дней) ещё идёт. У карты мог
    // кончиться срок — отключать в тот же день нельзя.
    await subscribe(agencyId, "past_due", new Date(Date.now() - DAY));

    const manual = await caller(agencyId).runs.triggerManual({ clientId });
    const audit = await caller(agencyId).runs.startAudit({ clientId });

    expect(manual.runId).toBeTruthy();
    expect(audit.runId).toBeTruthy();
  });

  it("просрочка сверх отсрочки останавливает", async () => {
    await subscribe(agencyId, "past_due", new Date(Date.now() - 20 * DAY));

    await expect(caller(agencyId).runs.triggerManual({ clientId })).rejects.toSatisfy(
      (error: unknown) => error instanceof TRPCError && error.code === "FORBIDDEN",
      "ожидался FORBIDDEN",
    );
  });

  it("отказ объясняет причину словами, а не кодом", async () => {
    await subscribe(agencyId, "canceled", new Date(Date.now() - DAY));

    const message = await caller(agencyId)
      .runs.triggerManual({ clientId })
      .catch((error: TRPCError) => error.message);

    expect(message).toMatch(/cancel/i);
  });

  it("отменённая подписка не мешает читать уже измеренное", async () => {
    // Останавливается трата денег, а не доступ к данным: отчёты и история
    // прогонов остаются открытыми, в том числе клиенту агентства на /r/[token].
    await subscribe(agencyId, "canceled", new Date(Date.now() - DAY));

    await expect(caller(agencyId).runs.list({ clientId })).resolves.toBeInstanceOf(Array);
    await expect(caller(agencyId).runs.schedule({ clientId })).resolves.toBeDefined();
  });

  it("бесплатные проверки кончаются, и измерение останавливается", async () => {
    // Раньше незаплативший аккаунт мог гонять аудиты бесконечно: месячный
    // лимит нигде не проверялся, он только показывался на экране.
    await incrementAiChecks(db, agencyId, billingPeriod(), FREE_CHECK_ALLOWANCE);

    await expect(caller(agencyId).runs.triggerManual({ clientId })).rejects.toSatisfy(
      (error: unknown) =>
        error instanceof TRPCError &&
        error.code === "FORBIDDEN" &&
        /free audit/i.test(error.message),
    );
  });

  it("та же граница закрывает и разовый аудит", async () => {
    await incrementAiChecks(db, agencyId, billingPeriod(), FREE_CHECK_ALLOWANCE);

    await expect(caller(agencyId).runs.startAudit({ clientId })).rejects.toSatisfy(
      (error: unknown) => error instanceof TRPCError && error.code === "FORBIDDEN",
    );
  });

  it("оплата снимает бесплатную границу", async () => {
    await incrementAiChecks(db, agencyId, billingPeriod(), FREE_CHECK_ALLOWANCE * 10);
    await subscribe(agencyId, "active", new Date(Date.now() + 30 * DAY));

    const result = await caller(agencyId).runs.triggerManual({ clientId });
    expect(result.runId).toBeTruthy();
  });

  it("плательщику месячный лимит тарифа — потолок", async () => {
    // Раньше лимит только показывался, и тариф мог тратить без конца.
    // Счётчик плательщика — по оплаченному месяцу, поэтому подписка раньше расхода.
    const periodEnd = new Date(Date.now() + 30 * DAY);
    await subscribe(agencyId, "active", periodEnd);
    await incrementAiChecks(db, agencyId, allowancePeriod(periodEnd), FREE_CHECK_ALLOWANCE * 100);

    await expect(caller(agencyId).runs.triggerManual({ clientId })).rejects.toThrow(/used up/);
  });

  it("отказ случается до создания прогона, а не после", async () => {
    // Иначе запись повисла бы в ожидании навсегда: воркер её не возьмёт,
    // а на экране она будет выглядеть начатым замером.
    await incrementAiChecks(db, agencyId, billingPeriod(), FREE_CHECK_ALLOWANCE);

    await expect(caller(agencyId).runs.triggerManual({ clientId })).rejects.toThrow();

    const runs = await caller(agencyId).runs.list({ clientId });
    expect(runs).toHaveLength(0);
  });
});
