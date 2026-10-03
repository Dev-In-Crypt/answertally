import { createRun, getClientById, listDueSchedules, setScheduleNextRun } from "@repo/db";
import type { Database } from "@repo/db";
import { measurementAllowedForAgency } from "@repo/pipeline";

export type Cadence = "daily" | "weekly" | "biweekly";

const CADENCE_DAYS: Record<Cadence, number> = { daily: 1, weekly: 7, biweekly: 14 };

/** Чистый расчёт следующего запуска — тестируется без БД. */
export function nextRunAfter(cadence: Cadence, from: Date): Date {
  return new Date(from.getTime() + CADENCE_DAYS[cadence] * 24 * 60 * 60 * 1000);
}

export interface TickResult {
  scheduleId: string;
  runId: string;
  clientId: string;
}

/** Расписание, созревшее у агентства без действующей подписки. */
export interface SkippedSchedule {
  scheduleId: string;
  clientId: string;
  reason: string;
}

export interface TickOutcome {
  started: TickResult[];
  skipped: SkippedSchedule[];
}

/**
 * Один тик планировщика: находит созревшие расписания, создаёт по прогону
 * и сдвигает next_run_at. Сдвиг выполняется сразу после создания прогона,
 * иначе следующий тик подхватил бы то же расписание повторно.
 *
 * Перед созданием прогона проверяется подписка агентства — той же функцией,
 * которой это проверяет веб при ручном запуске. Без этой проверки закрытой
 * оказывалась только кнопка: агентство с отменённой подпиской не могло
 * нажать «измерить», но его расписание продолжало опрашивать ассистентов
 * за наш счёт раз в две недели, месяцами и без единого клика. Ручной прогон
 * — это один человек и один раз; расписание — это расход, который никто не
 * останавливает.
 *
 * Расписание при отказе не выключается и не сдвигается: оплата
 * возобновляется, и выключенное расписание пришлось бы заводить заново
 * вручную, по всем клиентам сразу. Созревшее расписание просто ждёт.
 */
export async function tickSchedules(
  db: Database,
  now: Date = new Date(),
  adaptersMode: "mock" | "live" = "mock",
): Promise<TickOutcome> {
  const due = await listDueSchedules(db, now);
  const started: TickResult[] = [];
  const skipped: SkippedSchedule[] = [];

  // Права на агентство читаются один раз за тик: у одного агентства обычно
  // созревает сразу несколько клиентов, и спрашивать базу на каждого — это
  // те же данные тем же запросом.
  const byAgency = new Map<string, { allowed: boolean; message: string }>();

  for (const schedule of due) {
    const client = await getClientById(db, schedule.clientId);
    if (!client) {
      // Клиент удалён, а расписание осталось: измерять нечего.
      skipped.push({
        scheduleId: schedule.id,
        clientId: schedule.clientId,
        reason: "The client no longer exists.",
      });
      continue;
    }

    let decision = byAgency.get(client.agencyId);
    if (!decision) {
      decision = await measurementAllowedForAgency(db, client.agencyId, { trigger: "scheduled" }, now);
      byAgency.set(client.agencyId, decision);
    }

    if (!decision.allowed) {
      skipped.push({
        scheduleId: schedule.id,
        clientId: schedule.clientId,
        reason: decision.message,
      });
      continue;
    }

    const run = await createRun(db, {
      scheduleId: schedule.id,
      clientId: schedule.clientId,
      status: "pending",
      trigger: "scheduled",
      // Режим фиксируется в момент создания прогона: по нему потом решается,
      // складывать ли эти ответы с остальными измерениями клиента.
      adaptersMode,
    });

    await setScheduleNextRun(db, schedule.id, nextRunAfter(schedule.cadence, now));

    started.push({ scheduleId: schedule.id, runId: run.id, clientId: schedule.clientId });
  }

  return { started, skipped };
}
