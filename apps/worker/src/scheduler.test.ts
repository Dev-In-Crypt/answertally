import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createAgency,
  createClient,
  createDb,
  createRun,
  deleteAgency,
  getRunSchedule,
  listRunsByClient,
  setScheduleNextRun,
  upsertRunSchedule,
  upsertSubscription,
} from "@repo/db";
import { promptClusters, prompts, runSchedules } from "@repo/db/schema/measurement";
import { nextRunAfter, SKIP_RECHECK_MS, tickSchedules } from "./scheduler";
import { createConnection, createQueues } from "./queues";

/** Verify T16. Требует поднятых Postgres и Redis. */

const { db, close } = createDb();

describe("nextRunAfter", () => {
  const from = new Date("2026-08-11T10:00:00Z");

  it("weekly сдвигает на 7 дней", () => {
    expect(nextRunAfter("weekly", from).toISOString()).toBe("2026-08-18T10:00:00.000Z");
  });

  it("daily сдвигает на сутки", () => {
    expect(nextRunAfter("daily", from).toISOString()).toBe("2026-08-12T10:00:00.000Z");
  });

  it("biweekly сдвигает на две недели", () => {
    expect(nextRunAfter("biweekly", from).toISOString()).toBe("2026-08-25T10:00:00.000Z");
  });
});

describe("tickSchedules", () => {
  let agencyId = "";
  let clientId = "";
  let scheduleId = "";

  beforeEach(async () => {
    const agency = await createAgency(db, { name: "Tick Agency", clientLimit: 10 });
    agencyId = agency.id;
    // Измерение по расписанию — платная часть продукта, поэтому агентство здесь
    // платит. Бесплатный случай проверяется отдельно и явно.
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
      name: "Tick Client",
      domain: "tick.test",
    });
    clientId = client.id;

    const cluster = (
      await db
        .insert(promptClusters)
        .values({ clientId, name: "CRM comparison", intent: "comparison" })
        .returning()
    )[0]!;
    await db.insert(prompts).values({ clusterId: cluster.id, text: "best CRM for startups" });

    const rows = await db
      .insert(runSchedules)
      .values({ clientId, cadence: "weekly", platforms: ["chatgpt"], samplesPerPrompt: 3 })
      .returning();
    scheduleId = rows[0]!.id;
  });

  afterEach(async () => {
    await deleteAgency(db, agencyId);
  });

  afterAll(async () => {
    await close();
  });

  it("не трогает расписание без next_run_at — иначе первый тик запустил бы всех сразу", async () => {
    const { started } = await tickSchedules(db, new Date());
    expect(started.filter((r) => r.scheduleId === scheduleId)).toHaveLength(0);
    expect(await listRunsByClient(db, clientId)).toHaveLength(0);
  });

  it("не трогает расписание, чей срок ещё не наступил", async () => {
    await setScheduleNextRun(db, scheduleId, new Date(Date.now() + 60 * 60 * 1000));

    const { started } = await tickSchedules(db, new Date());
    expect(started.filter((r) => r.scheduleId === scheduleId)).toHaveLength(0);
    expect(await listRunsByClient(db, clientId)).toHaveLength(0);
  });

  it("подхватывает созревшее расписание и создаёт прогон", async () => {
    await setScheduleNextRun(db, scheduleId, new Date(Date.now() - 1000));

    const { started } = await tickSchedules(db, new Date());
    const mine = started.filter((r) => r.scheduleId === scheduleId);

    expect(mine).toHaveLength(1);

    const runs = await listRunsByClient(db, clientId);
    expect(runs).toHaveLength(1);
    expect(runs[0]?.status).toBe("pending");
    expect(runs[0]?.trigger).toBe("scheduled");
    expect(runs[0]?.scheduleId).toBe(scheduleId);
  });

  it("повторный тик не создаёт дубль — next_run_at сдвинут вперёд", async () => {
    await setScheduleNextRun(db, scheduleId, new Date(Date.now() - 1000));

    await tickSchedules(db, new Date());
    await tickSchedules(db, new Date());

    // Главная проверка: двойной прогон означал бы двойные расходы на API.
    expect(await listRunsByClient(db, clientId)).toHaveLength(1);
  });

  it("неактивное расписание игнорируется", async () => {
    await setScheduleNextRun(db, scheduleId, new Date(Date.now() - 1000));
    await db.update(runSchedules).set({ active: false });

    const { started } = await tickSchedules(db, new Date());
    expect(started.filter((r) => r.scheduleId === scheduleId)).toHaveLength(0);
  });

  it("расписание агентства без действующей подписки не запускается", async () => {
    await setScheduleNextRun(db, scheduleId, new Date(Date.now() - 1000));
    await upsertSubscription(db, {
      agencyId,
      customerId: `cus_cancelled_${agencyId}`,
      plan: "starter",
      status: "canceled",
      currentPeriodEnd: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    });

    const { started, skipped } = await tickSchedules(db, new Date());

    // Иначе отменившееся агентство продолжало бы опрашивать ассистентов за
    // наш счёт раз в две недели — месяцами и без единого клика.
    expect(started.filter((r) => r.scheduleId === scheduleId)).toHaveLength(0);
    expect(await listRunsByClient(db, clientId)).toHaveLength(0);

    // Пропуск виден и назван: молчание читалось бы как «замеров не было».
    const mine = skipped.find((s) => s.scheduleId === scheduleId);
    expect(mine?.reason).toBeTruthy();
  });

  it("отказ записывается в расписание, срок — на сутки; оплата вернётся — замер пойдёт", async () => {
    const due = new Date(Date.now() - 1000);
    await setScheduleNextRun(db, scheduleId, due);
    await upsertSubscription(db, {
      agencyId,
      customerId: `cus_lapsed_${agencyId}`,
      plan: "starter",
      status: "canceled",
      currentPeriodEnd: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    });

    const now = new Date();
    await tickSchedules(db, now);

    // Причина видна агентству, а «Next run» не застревает в прошлом.
    const skippedRow = await getRunSchedule(db, scheduleId);
    expect(skippedRow?.skipReason).toBeTruthy();
    expect(skippedRow?.nextRunAt?.getTime()).toBe(now.getTime() + SKIP_RECHECK_MS);

    // Подписка восстановлена — проверка через сутки берёт то же расписание.
    await upsertSubscription(db, {
      agencyId,
      customerId: `cus_lapsed_${agencyId}`,
      plan: "starter",
      status: "active",
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    const { started } = await tickSchedules(db, new Date(now.getTime() + SKIP_RECHECK_MS));
    expect(started.filter((r) => r.scheduleId === scheduleId)).toHaveLength(1);
    expect((await getRunSchedule(db, scheduleId))?.skipReason).toBeNull();
  });

  it("идущий ручной замер засчитывается за цикл — второй прогон не создаётся", async () => {
    await createRun(db, { clientId, scheduleId: null, trigger: "manual", adaptersMode: "live" });
    await setScheduleNextRun(db, scheduleId, new Date(Date.now() - 1000));

    const now = new Date();
    const { started, skipped } = await tickSchedules(db, now, "live");

    expect(started.filter((r) => r.scheduleId === scheduleId)).toHaveLength(0);
    expect(skipped.filter((s) => s.scheduleId === scheduleId)).toHaveLength(0);
    expect(await listRunsByClient(db, clientId)).toHaveLength(1);
    const row = await getRunSchedule(db, scheduleId);
    expect(row?.nextRunAt?.getTime()).toBe(nextRunAfter("weekly", now).getTime());
    expect(row?.skipReason).toBeNull();
  });

  it("без активных вопросов прогон не создаётся, а срок не сдвигается", async () => {
    // Раньше каждый цикл давал прогон failed без причины.
    await db.update(prompts).set({ active: false });
    const due = new Date(Date.now() - 1000);
    await setScheduleNextRun(db, scheduleId, due);

    const { started, skipped } = await tickSchedules(db, new Date());

    expect(started.filter((r) => r.scheduleId === scheduleId)).toHaveLength(0);
    expect(await listRunsByClient(db, clientId)).toHaveLength(0);
    expect(skipped.find((s) => s.scheduleId === scheduleId)?.reason).toMatch(/no active prompts/);
    // Вопросы появятся — замер начнётся в ближайший тик, а не через сутки.
    expect((await getRunSchedule(db, scheduleId))?.nextRunAt?.getTime()).toBe(due.getTime());

    // Следующий тик с той же причиной молчит: ни записи, ни строки в логе каждые пять минут.
    const skippedAt = (await getRunSchedule(db, scheduleId))?.skippedAt?.getTime();
    const again = await tickSchedules(db, new Date(Date.now() + 60_000));
    expect(again.skipped.filter((s) => s.scheduleId === scheduleId)).toHaveLength(0);
    expect((await getRunSchedule(db, scheduleId))?.skippedAt?.getTime()).toBe(skippedAt);
  });

  it("у бесплатного аккаунта расписание не запускается вовсе", async () => {
    /**
     * Даже с нетронутым лимитом. Бесплатный аудит — один и руками; измерение
     * по расписанию — платная часть. Раньше здесь проверялась только граница
     * проверок, а счётчик был месячным: брошенный аккаунт с сохранённым
     * расписанием получал новый аудит первого числа, бессрочно, за наш счёт.
     */
    const free = await createAgency(db, { name: "Free Agency", clientLimit: 3 });
    try {
      const client = await createClient(db, {
        agencyId: free.id,
        name: "Free Client",
        domain: "free.test",
      });
      const freeSchedule = (
        await db
          .insert(runSchedules)
          .values({
            clientId: client.id,
            cadence: "weekly",
            platforms: ["chatgpt"],
            samplesPerPrompt: 3,
          })
          .returning()
      )[0]!;
      await setScheduleNextRun(db, freeSchedule.id, new Date(Date.now() - 1000));

      const { started, skipped } = await tickSchedules(db, new Date());

      expect(started.filter((r) => r.scheduleId === freeSchedule.id)).toHaveLength(0);
      expect(await listRunsByClient(db, client.id)).toHaveLength(0);
      expect(skipped.find((s) => s.scheduleId === freeSchedule.id)?.reason).toMatch(/free audit/i);
    } finally {
      await deleteAgency(db, free.id);
    }
  });

  it("ежедневная частота после понижения тарифа не действует", async () => {
    // Daily — только на Scale; сохранённая раньше, она не должна тратить
    // в четырнадцать раз больше на Starter.
    await upsertRunSchedule(db, clientId, {
      cadence: "daily",
      platforms: ["chatgpt"],
      samplesPerPrompt: 3,
      active: true,
    });
    await setScheduleNextRun(db, scheduleId, new Date(Date.now() - 1000));

    const { started, skipped } = await tickSchedules(db, new Date());

    expect(started.filter((r) => r.scheduleId === scheduleId)).toHaveLength(0);
    expect(skipped.find((s) => s.scheduleId === scheduleId)?.reason).toMatch(/daily/);
  });

  it("клиентов больше, чем покрывает тариф, — измерение стоит", async () => {
    // Лимит проверялся только при заведении: понижение тарифа оставляло всех.
    for (const n of [1, 2, 3]) {
      await createClient(db, { agencyId, name: `Extra ${n}`, domain: `extra${n}.test` });
    }
    await setScheduleNextRun(db, scheduleId, new Date(Date.now() - 1000));

    const { started, skipped } = await tickSchedules(db, new Date());

    expect(started.filter((r) => r.scheduleId === scheduleId)).toHaveLength(0);
    expect(skipped.find((s) => s.scheduleId === scheduleId)?.reason).toMatch(/Remove clients/);
  });

  it("действующая подписка измерение не останавливает", async () => {
    await setScheduleNextRun(db, scheduleId, new Date(Date.now() - 1000));
    await upsertSubscription(db, {
      agencyId,
      customerId: `cus_active_${agencyId}`,
      plan: "growth",
      status: "active",
      currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
    });

    const { started, skipped } = await tickSchedules(db, new Date());

    expect(started.filter((r) => r.scheduleId === scheduleId)).toHaveLength(1);
    expect(skipped.filter((s) => s.scheduleId === scheduleId)).toHaveLength(0);
  });
});

describe("queues", () => {
  it("имена очередей платформ валидны для BullMQ", async () => {
    const { runsQueueName } = await import("./queues");
    const { PLATFORMS } = await import("@repo/core");

    for (const platform of PLATFORMS) {
      const name = runsQueueName(platform);
      // BullMQ 6 отвергает ":" в имени очереди — поймано смоук-тестом, закреплено здесь.
      expect(name).not.toContain(":");
      expect(name).toBe(`runs-${platform}`);
    }
  });

  it("подключаются к Redis и объявляют три очереди", async () => {
    const connection = createConnection();
    const queues = createQueues(connection);

    expect(Object.keys(queues).sort()).toEqual(["aggregate", "parse", "runs"]);
    // Реальный round-trip к Redis: конфигурация подключения проверяется, а не только типы.
    await expect(queues.runs.getJobCounts()).resolves.toHaveProperty("waiting");

    await Promise.all([queues.runs.close(), queues.parse.close(), queues.aggregate.close()]);
    connection.disconnect();
  });
});
