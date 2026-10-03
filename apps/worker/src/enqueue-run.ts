import type { FlowProducer } from "bullmq";
import {
  claimPendingRun,
  getAgencyIdForRun,
  failStaleRuns,
  finishRun,
  getRunById,
  getRunSchedule,
  listActivePromptsForClient,
  listPendingRuns,
  releaseRun,
} from "@repo/db";
import type { Database } from "@repo/db";
import type { AdaptersMode } from "@repo/core";
import { capabilitiesForAgency, platformsForRun } from "@repo/core/config/measurement";
import { entitlementsForAgency, planRunJobs } from "@repo/pipeline";
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
    await finishRun(db, runId, "failed");
    return 0;
  }
  const entitlements = await entitlementsForAgency(db, agencyId);
  const platforms = platformsForRun(capabilitiesForAgency(entitlements), schedule?.platforms);
  const samples = schedule?.samplesPerPrompt ?? 3;

  const prompts = await listActivePromptsForClient(db, clientId);
  const jobs = planRunJobs(runId, prompts, platforms, samples);

  if (jobs.length === 0) {
    // Спрашивать нечего — прогон закрывается, а не висит в ожидании: иначе
    // подбор брал бы его снова каждые несколько секунд.
    await finishRun(db, runId, "failed");
    return 0;
  }

  // Тратится не больше одобренного. Между проверкой в вебе и этим местом
  // проходит до пятнадцати секунд, и раньше за них можно было загрузить
  // тысячи вопросов и поднять выборки до десяти — воркер ставил всё, что
  // находил. Прогон без размера создан до появления поля.
  if (!entitlements.active || (run.plannedChecks !== null && jobs.length > run.plannedChecks)) {
    await finishRun(db, runId, "failed");
    return 0;
  }

  if (!(await claimPendingRun(db, runId))) {
    return 0;
  }

  try {
    await flow.add({
      name: "finalize",
      queueName: QUEUE_NAMES.finalize,
      data: { runId, clientId, expected: jobs.length } satisfies FinalizeJobData,
      opts: JOB_RETENTION,
      children: jobs.map((job) => ({
        name: `${job.platform}-${job.sampleIndex}`,
        queueName: runsQueueName(job.platform),
        data: job satisfies RunJobData,
        // Упавший ответ не держит сборку прогона: без этого один таймаут
        // оставлял прогон «в процессе» навсегда, без свёртки и без цифр.
        // Сборка и так считает, сколько ответов дошло. Повторов нет
        // намеренно: каждая попытка — платный вызов.
        opts: { ...JOB_RETENTION, ignoreDependencyOnFailure: true },
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
