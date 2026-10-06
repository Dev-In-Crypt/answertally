import type { FlowProducer } from "bullmq";
import {
  claimPendingRun,
  getAgencyIdForRun,
  failStaleRuns,
  finishRunWithNote,
  getRunById,
  getRunSchedule,
  listActivePromptsForClient,
  listPendingRuns,
  releaseRun,
  setRunNote,
} from "@repo/db";
import type { Database } from "@repo/db";
import { liveAdapterPlatforms, type AdaptersMode } from "@repo/core";
import { capabilitiesForAgency, platformsForRun } from "@repo/core/config/measurement";
import { entitlementsForAgency, NO_ACTIVE_PROMPTS_NOTE, planRunJobs } from "@repo/pipeline";
import { QUEUE_NAMES, runsQueueName, type FinalizeJobData, type RunJobData } from "./queues";

/**
 * Сколько задачи живут в Redis после завершения.
 *
 * Без этого каждая выполненная задача — с текстом вопроса — оставалась в
 * Redis навсегда. Память росла до предела контейнера, и очередь падала
 * целиком. Сутки на разбор удачных и неделя на разбор упавших.
 */
const JOB_RETENTION = {
  removeOnComplete: { age: 24 * 60 * 60 },
  removeOnFail: { age: 7 * 24 * 60 * 60 },
};

/** Сколько раз пробуется сборка прогона, прежде чем он считается упавшим. */
export const FINALIZE_ATTEMPTS = 3;

/** Пояснение к прогону, сборка которого не удалась ни с одной попытки. */
export const FINALIZE_FAILED_NOTE =
  "The answers came back, but working out the results failed. The answers are saved; results update with the next check.";

/**
 * Ставит задачи прогона в очереди платформ и вешает на них сборку.
 *
 * Flow, а не счётчик выполненных: сборка запускается тогда, когда доехали
 * все ответы, и это гарантирует очередь, а не наша арифметика. Считать
 * готовность самим значило бы однажды собрать прогон на половине данных.
 *
 * Прогон забирается из pending ровно один раз (`claimPendingRun`): его
 * ставят и тик расписания, и подбор ручных прогонов, и два прохода не должны
 * спросить ассистентов дважды. Возвращает число поставленных задач; 0 —
 * если ставить нечего или прогон уже забрал кто-то другой.
 */
export async function enqueueRun(
  db: Database,
  flow: FlowProducer,
  runId: string,
  clientId: string,
): Promise<number> {
  const run = await getRunById(db, runId);
  if (!run) {
    throw new Error(`Run ${runId} not found`);
  }
  if (run.status !== "pending") {
    return 0;
  }

  const schedule = run.scheduleId ? await getRunSchedule(db, run.scheduleId) : undefined;
  /**
   * Кого спросить — по правам агентства, а не по общему умолчанию.
   *
   * Это боевой путь: в живом режиме веб только создаёт прогон, а ставит его
   * в очередь этот код. Здесь стояло «расписание или тройка по умолчанию»
   * без тарифа и без платности, и бесплатный аудит спрашивал Grok за наш
   * счёт, хотя в функции прогона его уже убрали. Решает теперь одна функция.
   */
  const agencyId = await getAgencyIdForRun(db, runId);
  if (!agencyId) {
    // Клиент удалён вместе с агентством — спрашивать не для кого.
    await finishRunWithNote(db, runId, "failed", "The client no longer exists.");
    return 0;
  }
  const entitlements = await entitlementsForAgency(db, agencyId);
  const allowed = platformsForRun(capabilitiesForAgency(entitlements), schedule?.platforms);
  // Ассистент без ключа на сервере не спрашивается: раньше каждая его задача
  // падала, и любой прогон с ним выглядел сбоем. Об этом говорит пояснение.
  const available = run.adaptersMode === "live" ? new Set(liveAdapterPlatforms()) : null;
  const platforms = available ? allowed.filter((p) => available.has(p)) : allowed;
  const unavailable = allowed.filter((p) => !platforms.includes(p));
  const samples = schedule?.samplesPerPrompt ?? 3;

  const prompts = await listActivePromptsForClient(db, clientId);
  const jobs = planRunJobs(runId, prompts, platforms, samples);

  if (jobs.length === 0) {
    // Спрашивать нечего — прогон закрывается, а не висит в ожидании: иначе
    // подбор брал бы его снова каждые несколько секунд.
    await finishRunWithNote(
      db,
      runId,
      "failed",
      prompts.length === 0
        ? NO_ACTIVE_PROMPTS_NOTE
        : "None of this run's assistants are available right now, so nothing was asked and no checks were used.",
    );
    return 0;
  }

  // Тратится не больше одобренного. Между проверкой в вебе и этим местом
  // проходит до пятнадцати секунд, и раньше за них можно было загрузить
  // тысячи вопросов и поднять выборки до десяти — воркер ставил всё, что
  // находил. Прогон без размера создан до появления поля.
  if (!entitlements.active) {
    await finishRunWithNote(
      db,
      runId,
      "failed",
      "The subscription is not active, so nothing was asked. Renew it under Settings → Billing.",
    );
    return 0;
  }
  if (run.plannedChecks !== null && jobs.length > run.plannedChecks) {
    await finishRunWithNote(
      db,
      runId,
      "failed",
      "Prompts were added after this check started, so it stopped before asking anything. Start it again to include them.",
    );
    return 0;
  }

  if (!(await claimPendingRun(db, runId))) {
    return 0;
  }

  try {
    await flow.add({
      name: "finalize",
      queueName: QUEUE_NAMES.finalize,
      data: { runId, clientId, expected: jobs.length, unavailable } satisfies FinalizeJobData,
      // Сборка повторяется: её шаги идемпотентны, а статус прогона ставится
      // последним. Без повторов сбой базы посреди свёртки оставлял прогон
      // без цифр до следующего замера через две недели.
      opts: { ...JOB_RETENTION, attempts: FINALIZE_ATTEMPTS, backoff: { type: "exponential", delay: 30_000 } },
      children: jobs.map((job) => ({
        name: `${job.platform}-${job.sampleIndex}`,
        queueName: runsQueueName(job.platform),
        data: job satisfies RunJobData,
        // Упавший ответ не держит сборку прогона: без этого один таймаут
        // оставлял прогон «в процессе» навсегда, без свёртки и без цифр.
        // Сборка и так считает, сколько ответов дошло. Повторяется только
        // отказ «слишком часто» (воркер помечает остальное неповторяемым):
        // он не тарифицируется, а без повтора терялась часть ответов.
        opts: {
          ...JOB_RETENTION,
          ignoreDependencyOnFailure: true,
          attempts: 4,
          backoff: { type: "exponential", delay: 20_000 },
        },
      })),
    });
  } catch (error) {
    // Очередь недоступна — прогон возвращается в ожидание и будет подобран
    // снова, а не остаётся «running» без единой задачи.
    await releaseRun(db, runId);
    throw error;
  }

  return jobs.length;
}

/** Сколько ждёт ручной прогон, прежде чем считаться забытым. */
export const PENDING_RUN_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export interface PendingPickup {
  queuedRuns: number;
  queuedJobs: number;
  failedRuns: string[];
  expiredRuns: string[];
}

/**
 * Подбирает прогоны, созданные вебом: ручной «Run now» и аудит.
 *
 * В живом режиме веб только создаёт прогон — поставить его в очередь может
 * лишь воркер. До этого подбора такие прогоны не выполнялись никогда, а
 * экран аудита всё равно показывал «готово». Заодно подбираются прогоны по
 * расписанию, для которых постановка сорвалась.
 */
export async function pickUpPendingRuns(
  db: Database,
  flow: FlowProducer,
  mode: AdaptersMode,
  now: Date = new Date(),
): Promise<PendingPickup> {
  const cutoff = new Date(now.getTime() - PENDING_RUN_MAX_AGE_MS);
  const expiredRuns = await failStaleRuns(db, mode, cutoff);
  for (const runId of expiredRuns) {
    await setRunNote(
      db,
      runId,
      "This check did not finish within a day and was closed. Any answers that came back are kept.",
    );
  }

  const pending = await listPendingRuns(db, mode, cutoff);
  const result: PendingPickup = { queuedRuns: 0, queuedJobs: 0, failedRuns: [], expiredRuns };

  for (const run of pending) {
    try {
      const jobs = await enqueueRun(db, flow, run.id, run.clientId);
      if (jobs > 0) {
        result.queuedRuns++;
        result.queuedJobs += jobs;
      }
    } catch {
      result.failedRuns.push(run.id);
    }
  }

  return result;
}
