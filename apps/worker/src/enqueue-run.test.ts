import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FlowProducer } from "bullmq";
import {
  createAgency,
  createClient,
  createDb,
  createRun,
  deleteAgency,
  getRunById,
  upsertSubscription,
} from "@repo/db";
import { promptClusters, prompts } from "@repo/db/schema/measurement";
import { PENDING_RUN_MAX_AGE_MS, pickUpPendingRuns } from "./enqueue-run";

/**
 * Подбор прогонов, созданных вебом. Требует поднятого Postgres; очередь
 * подменена — проверяется, что и сколько раз в неё ставится.
 *
 * До этого подбора ручной «Run now» и аудит в живом режиме не выполнялись
 * вовсе: веб создавал прогон, и никто не ставил его в очередь.
 */

const { db, close } = createDb();

function fakeFlow(impl?: () => Promise<unknown>) {
  const add = vi.fn(impl ?? (() => Promise.resolve({})));
  return { flow: { add } as unknown as FlowProducer, add };
}

describe("pickUpPendingRuns", () => {
  let agencyId = "";
  let clientId = "";

  beforeEach(async () => {
    const agency = await createAgency(db, { name: "Pickup Agency", clientLimit: 10 });
    agencyId = agency.id;
    clientId = (await createClient(db, { agencyId, name: "Pickup Client", domain: "pickup.test" })).id;

    const cluster = (
      await db
        .insert(promptClusters)
        .values({ clientId, name: "CRM comparison", intent: "comparison" })
        .returning()
    )[0]!;
    await db.insert(prompts).values([
      { clusterId: cluster.id, text: "best CRM for startups" },
      { clusterId: cluster.id, text: "HubSpot alternatives" },
    ]);
  });

  afterEach(async () => {
    await deleteAgency(db, agencyId);
  });

  afterAll(async () => {
    await close();
  });

  function manualRun(mode: "mock" | "live" = "live") {
    return createRun(db, { clientId, scheduleId: null, trigger: "manual", adaptersMode: mode });
  }

  /** Агентство-плательщик: у него набор тарифа, а не бесплатного аудита. */
  async function makePaying() {
    await upsertSubscription(db, {
      agencyId,
      customerId: `cus_${agencyId.slice(0, 8)}`,
      subscriptionId: `sub_${agencyId.slice(0, 8)}`,
      plan: "starter",
      status: "active",
      currentPeriodEnd: new Date("2099-01-01T00:00:00.000Z"),
      cancelAtPeriodEnd: false,
    });
  }

  /** Очереди платформ, в которые попали задачи прогона. */
  function queuedPlatforms(add: ReturnType<typeof fakeFlow>["add"]): string[] {
    const call = add.mock.calls[0] as unknown as [{ children: { queueName: string }[] }];
    return [...new Set(call[0].children.map((child) => child.queueName))].sort();
  }

  it("ставит ручной живой прогон в очередь: 2 промпта × 3 платформы × 3 сэмпла", async () => {
    await makePaying();
    const run = await manualRun();
    const { flow, add } = fakeFlow();

    const result = await pickUpPendingRuns(db, flow, "live");

    expect(result.queuedRuns).toBe(1);
    expect(result.queuedJobs).toBe(18);
    expect(add).toHaveBeenCalledTimes(1);
    expect((await getRunById(db, run.id))?.status).toBe("running");
  });

  it("больше одобренного в очередь не ставится", async () => {
    /**
     * Веб одобрил прогон на 12 ответов, а за секунды до подбора человек
     * загрузил ещё вопросы. Раньше воркер ставил всё, что находил, и
     * бесплатный аудит раздувался в сотни долларов.
     */
    const run = await createRun(db, {
      clientId,
      scheduleId: null,
      trigger: "manual",
      adaptersMode: "live",
      plannedChecks: 6,
    });
    const { flow, add } = fakeFlow();

    const result = await pickUpPendingRuns(db, flow, "live");

    expect(result.queuedJobs).toBe(0);
    expect(add).not.toHaveBeenCalled();
    expect((await getRunById(db, run.id))?.status).toBe("failed");
  });

  it("одобренный размер ставится как есть", async () => {
    await createRun(db, {
      clientId,
      scheduleId: null,
      trigger: "manual",
      adaptersMode: "live",
      plannedChecks: 12,
    });
    const { flow } = fakeFlow();

    expect((await pickUpPendingRuns(db, flow, "live")).queuedJobs).toBe(12);
  });

  it("отменившему подписку прогон в очередь не ставится", async () => {
    await upsertSubscription(db, {
      agencyId,
      customerId: `cus_${agencyId.slice(0, 8)}`,
      subscriptionId: `sub_${agencyId.slice(0, 8)}`,
      plan: "starter",
      status: "canceled",
      currentPeriodEnd: new Date("2000-01-01T00:00:00.000Z"),
      cancelAtPeriodEnd: false,
    });
    const run = await manualRun();
    const { flow, add } = fakeFlow();

    await pickUpPendingRuns(db, flow, "live");

    expect(add).not.toHaveBeenCalled();
    expect((await getRunById(db, run.id))?.status).toBe("failed");
  });

  it("бесплатный аудит не ставит в очередь Grok", async () => {
    /**
     * Это боевой путь: в живом режиме веб только создаёт прогон, а ставит
     * его в очередь этот код. Здесь стояло «расписание или тройка по
     * умолчанию» без платности, и Grok — $0.1058 за ответ, 89% цены круга —
     * отвечал на бесплатных аудитах, хотя в функции прогона его уже убрали.
     * Тест на функцию прогона проходил, а этот путь никто не проверял.
     */
    await manualRun();
    const { flow, add } = fakeFlow();

    const result = await pickUpPendingRuns(db, flow, "live");

    // 2 промпта × 2 платформы × 3 сэмпла.
    expect(result.queuedJobs).toBe(12);
    expect(queuedPlatforms(add).some((queue) => queue.includes("grok"))).toBe(false);
  });

  it("плательщику Grok ставится", async () => {
    // Иначе это была бы не граница бесплатного аудита, а потеря ассистента.
    await makePaying();
    await manualRun();
    const { flow, add } = fakeFlow();

    await pickUpPendingRuns(db, flow, "live");

    expect(queuedPlatforms(add).some((queue) => queue.includes("grok"))).toBe(true);
  });

  it("два одновременных прохода ставят прогон ровно один раз", async () => {
    const run = await manualRun();
    const { flow, add } = fakeFlow();

    await Promise.all([pickUpPendingRuns(db, flow, "live"), pickUpPendingRuns(db, flow, "live")]);

    // Иначе ассистентов спросили бы дважды за одни деньги.
    expect(add).toHaveBeenCalledTimes(1);
    expect((await getRunById(db, run.id))?.status).toBe("running");
  });

  it("живой воркер не берёт прогон, созданный на заглушках", async () => {
    // Проход идёт в живом режиме: в общей тестовой базе лежат ожидающие
    // прогоны-заглушки других тестов, и проход в режиме заглушек забрал бы их.
    const run = await manualRun("mock");
    const { flow, add } = fakeFlow();

    await pickUpPendingRuns(db, flow, "live");

    expect(add).not.toHaveBeenCalled();
    expect((await getRunById(db, run.id))?.status).toBe("pending");
  });

  it("прогон без вопросов закрывается как неудавшийся, а не висит в ожидании", async () => {
    // Отдельный клиент без вопросов: база общая с тестами других пакетов,
    // и стирать чужие вопросы ради этой проверки нельзя.
    const empty = await createClient(db, { agencyId, name: "No Prompts", domain: "empty.test" });
    const run = await createRun(db, {
      clientId: empty.id,
      scheduleId: null,
      trigger: "manual",
      adaptersMode: "live",
    });
    const { flow, add } = fakeFlow();

    await pickUpPendingRuns(db, flow, "live");
    const second = await pickUpPendingRuns(db, flow, "live");

    expect(add).not.toHaveBeenCalled();
    expect((await getRunById(db, run.id))?.status).toBe("failed");
    expect(second.queuedRuns).toBe(0);
  });

  it("прогон старше суток не запускается, а закрывается как неудавшийся", async () => {
    const run = await manualRun();
    // «Сейчас» сдвинуто на сутки вперёд — прогон становится прождавшим.
    const later = new Date(Date.now() + PENDING_RUN_MAX_AGE_MS + 60_000);
    const { flow, add } = fakeFlow();

    const result = await pickUpPendingRuns(db, flow, "live", later);

    // Запускать его сейчас значило бы потратить деньги на забытый замер.
    expect(add).not.toHaveBeenCalled();
    expect(result.expiredRuns).toContain(run.id);
    expect((await getRunById(db, run.id))?.status).toBe("failed");
  });

  it("сбой очереди возвращает прогон в ожидание, чтобы подобрать его снова", async () => {
    const run = await manualRun();
    const { flow } = fakeFlow(() => Promise.reject(new Error("redis is down")));

    const result = await pickUpPendingRuns(db, flow, "live");

    expect(result.failedRuns).toEqual([run.id]);
    expect((await getRunById(db, run.id))?.status).toBe("pending");

    const { flow: healthy, add } = fakeFlow();
    await pickUpPendingRuns(db, healthy, "live");
    expect(add).toHaveBeenCalledTimes(1);
  });
});
