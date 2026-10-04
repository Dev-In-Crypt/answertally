import {
  allowsCadence,
  capabilitiesForAgency,
  plannedChecksForRun,
} from "@repo/core/config/measurement";
import {
  getClientById,
  listActivePromptsForClient,
  listDueSchedules,
  setScheduleOutcome,
} from "@repo/db";
import type { Database } from "@repo/db";
import {
  entitlementsForAgency,
  measurementAllowedForAgency,
  NO_ACTIVE_PROMPTS_NOTE,
  RUN_IN_FLIGHT_MESSAGE,
  startRunIfAllowed,
} from "@repo/pipeline";

export type Cadence = "daily" | "weekly" | "biweekly";

const CADENCE_DAYS: Record<Cadence, number> = { daily: 1, weekly: 7, biweekly: 14 };

/** Через сколько пропущенное расписание проверяется снова. */
export const SKIP_RECHECK_MS = 24 * 60 * 60 * 1000;

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
 * Расписание при отказе не выключается: оплата возобновляется, и
 * выключенное расписание пришлось бы заводить заново вручную, по всем
 * клиентам сразу. Причина пропуска записывается в расписание (её видит
 * агентство), а срок сдвигается на сутки: экран не показывает прошедшую
 * дату, а возобновлённая оплата или новый месяц подхватываются за день.
 * Без вопросов срок не сдвигается вовсе — первый замер начнётся в
 * ближайший тик после того, как вопросы появятся.
 */
export async function tickSchedules(
  db: Database,
  now: Date = new Date(),
  adaptersMode: "mock" | "live" = "mock",
): Promise<TickOutcome> {
  const due = await listDueSchedules(db, now);
  const started: TickResult[] = [];
  const skipped: SkippedSchedule[] = [];

  async function skip(
    schedule: { id: string; clientId: string; skipReason: string | null },
    reason: string,
    recheck: boolean = true,
  ): Promise<void> {
    // Без сдвига срока расписание созревает каждый тик: та же причина уже
    // записана — не переписывать её и не сыпать в лог раз в пять минут.
    if (!recheck && schedule.skipReason === reason) return;
    skipped.push({ scheduleId: schedule.id, clientId: schedule.clientId, reason });
    await setScheduleOutcome(db, schedule.id, {
      skipReason: reason,
      at: now,
      ...(recheck ? { nextRunAt: new Date(now.getTime() + SKIP_RECHECK_MS) } : {}),
    });
  }

  for (const schedule of due) {
    const client = await getClientById(db, schedule.clientId);
    if (!client) {
      // Клиент удалён, а расписание осталось: измерять нечего.
      await skip(schedule, "The client no longer exists.");
      continue;
    }

    // Права и размер — на каждое расписание отдельно, без кэша на агентство:
    // с месячным потолком каждое созревшее расписание тратит свою долю, и
    // решение, принятое для первого, для третьего уже неверно.
    const entitlements = await entitlementsForAgency(db, client.agencyId, now);

    // Частота, сохранённая на старшем тарифе, после понижения не действует:
    // ежедневный опрос — четырнадцатикратный расход против базового.
    if (!allowsCadence(entitlements.plan, schedule.cadence)) {
      await skip(
        schedule,
        `The ${entitlements.plan.charAt(0).toUpperCase() + entitlements.plan.slice(1)} plan does not include ${schedule.cadence} checks. Pick another cadence on the measure screen, or upgrade under Settings → Billing.`,
      );
      continue;
    }

    const prompts = await listActivePromptsForClient(db, schedule.clientId);
    if (prompts.length === 0) {
      // Раньше такой прогон создавался и закрывался failed каждый цикл —
      // счётчик сбоев рос, а настоящая причина нигде не называлась. Отказ
      // по подписке важнее: без неё и с вопросами ничего не начнётся.
      const gate = await measurementAllowedForAgency(
        db,
        client.agencyId,
        { trigger: "scheduled", checksPlanned: 0 },
        now,
      );
      if (gate.allowed) {
        await skip(schedule, NO_ACTIVE_PROMPTS_NOTE, false);
      } else {
        await skip(schedule, gate.message);
      }
      continue;
    }
    const checksPlanned = plannedChecksForRun(
      capabilitiesForAgency(entitlements),
      prompts.length,
      schedule,
    );

    const { decision, run } = await startRunIfAllowed(
      db,
      client.agencyId,
      {
        scheduleId: schedule.id,
        clientId: schedule.clientId,
        status: "pending",
        trigger: "scheduled",
        // Режим фиксируется в момент создания прогона: по нему потом решается,
        // складывать ли эти ответы с остальными измерениями клиента.
        adaptersMode,
      },
      checksPlanned,
      now,
    );

    // Замер клиента уже идёт (нажали «Run now» перед сроком) — он и есть
    // замер этого цикла: второй по тем же вопросам был бы второй оплатой.
    if (!run && decision.message !== RUN_IN_FLIGHT_MESSAGE) {
      await skip(schedule, decision.message);
      continue;
    }

    await setScheduleOutcome(db, schedule.id, {
      skipReason: null,
      at: now,
      nextRunAt: nextRunAfter(schedule.cadence, now),
    });

    if (run) {
      started.push({ scheduleId: schedule.id, runId: run.id, clientId: schedule.clientId });
    }
  }

  return { started, skipped };
}
