import { FlowProducer, Queue, UnrecoverableError, Worker } from "bullmq";
import { createDb, failRunIfInFlight } from "@repo/db";
import {
  measurableAssistants,
  PLATFORMS,
  parseAdaptersMode,
  registerLiveAdapters,
} from "@repo/core";
import { ProviderHttpError } from "@repo/core/adapters/http";
import { ADAPTERS_MODE_RAW } from "./env";
import {
  createConnection,
  createQueues,
  PLATFORM_RATE_LIMITS,
  QUEUE_NAMES,
  runsQueueName,
  type FinalizeJobData,
  type RunJobData,
} from "./queues";
import { tickSchedules } from "./scheduler";
import { enqueueRun, FINALIZE_FAILED_NOTE, pickUpPendingRuns } from "./enqueue-run";
import { executeRunJob, finalizeRun } from "@repo/pipeline";
import { errorReporter, logger } from "./observability";
import { notifyMeasurementReady } from "./notify-ready";

const TICK_QUEUE = "scheduler-tick";
const TICK_JOB = "find-due-schedules";
const TICK_EVERY_MS = 5 * 60 * 1000;
/**
 * Как часто подбираются прогоны, созданные вебом. Чаще тика расписания:
 * человек нажал «Run now» или запустил аудит и смотрит на экран — пять минут
 * тишины он прочтёт как поломку. Запрос дешёвый: индекс по статусу не нужен,
 * ожидающих прогонов единицы.
 */
const PICKUP_EVERY_MS = 15 * 1000;

function isRateLimited(error: unknown): boolean {
  if (error instanceof ProviderHttpError) return error.status === 429;
  // Адаптер OpenAI старше общего транспорта и кладёт статус только в текст.
  return error instanceof Error && error.message.startsWith("OpenAI responded 429:");
}

async function main(): Promise<void> {
  const mode = parseAdaptersMode(ADAPTERS_MODE_RAW);

  if (mode === "live") {
    const platforms = registerLiveAdapters();
    logger.info("adapters.live_registered", { platforms });
    // Ассистент без ключа прогоны пропускают с пояснением — но это решение
    // оператора, а не норма: в лог как ошибка, чтобы его увидели при выкатке.
    const missing = measurableAssistants()
      .map((assistant) => assistant.id)
      .filter((id) => !platforms.includes(id));
    if (missing.length > 0) {
      logger.error("adapters.live_missing", { missing });
    }
  }
  const connection = createConnection();
  const { db, close: closeDb } = createDb();
  const queues = createQueues(connection);

  const tickQueue = new Queue(TICK_QUEUE, { connection });
  await tickQueue.upsertJobScheduler(TICK_JOB, { every: TICK_EVERY_MS });

  const flow = new FlowProducer({ connection });

  const tickWorker = new Worker(
    TICK_QUEUE,
    async () => {
      const { started, skipped } = await tickSchedules(db, new Date(), mode);

      for (const schedule of skipped) {
        // Причину агентство видит на экране (она записана в расписание);
        // здесь — для оператора.
        logger.warn("scheduler.skipped", { ...schedule });
      }

      let queued = 0;
      let failed = 0;
      for (const result of started) {
        // Прогон, для которого не поставили задачи, остаётся pending навсегда:
        // расписание сдвинуто, а измерения нет — и заметить это можно только
        // по молчанию цифр через неделю.
        //
        // Каждое расписание ставится отдельно: сбой у одного клиента не
        // должен отменять замер у всех остальных в этом тике.
        try {
          queued += await enqueueRun(db, flow, result.runId, result.clientId);
        } catch (error) {
          failed++;
          logger.error("scheduler.enqueue_failed", {
            runId: result.runId,
            clientId: result.clientId,
            message: error instanceof Error ? error.message : String(error),
          });
          errorReporter.captureError(error, { scope: "scheduler.enqueue", runId: result.runId });
        }
      }

      if (started.length > 0) {
        logger.info("scheduler.tick", {
          startedRuns: started.length,
          queuedJobs: queued,
          failedSchedules: failed,
          runIds: started.map((result) => result.runId),
        });
      }
      return { started: started.length, queued, failed };
    },
    { connection },
  );

  const finalizeWorker = new Worker<FinalizeJobData>(
    QUEUE_NAMES.finalize,
    async (job) => {
      const outcome = await finalizeRun(db, {
        ...job.data,
        /**
         * Пересчёт возможностей не роняет прогон — но и не должен падать
         * молча. Без этого ошибка в детекторе выглядела бы как «сегодня
         * ничего не нашли», и заметили бы её через недели.
         */
        onError: (error) => {
          logger.error("run.opportunities_failed", { runId: job.data.runId });
          errorReporter.captureError(error, {
            scope: "run.opportunities",
            runId: job.data.runId,
            clientId: job.data.clientId,
          });
        },
      });
      logger.info("run.finalized", { runId: job.data.runId, ...outcome });
      // Письмо не должно ни ронять, ни повторять сборку: сбой почты — в отчёт об ошибках.
      if (outcome.status === "done") {
        await notifyMeasurementReady(db, job.data.runId).catch((error: unknown) =>
          errorReporter.captureError(error, { scope: "run.notify_ready", runId: job.data.runId }),
        );
      }
      return outcome;
    },
    { connection },
  );

  // Сборка не удалась ни с одной попытки — прогон закрывается с причиной,
  // а не висит «в процессе» сутки до закрытия по сроку.
  finalizeWorker.on("failed", (job) => {
    // Попытки берутся из самой задачи: поставленная до выкатки повторов не
    // имеет, и её первый сбой — уже последний.
    if (!job || job.attemptsMade < (job.opts.attempts ?? 1)) return;
    // Только идущий: запоздавший сбой не затирает уже закончившийся прогон.
    void failRunIfInFlight(db, job.data.runId, FINALIZE_FAILED_NOTE).catch((error) =>
      errorReporter.captureError(error, { scope: "run.finalize_close", runId: job.data.runId }),
    );
  });

  // По воркеру на платформу: свой лимит частоты у каждого провайдера.
  const runWorkers = PLATFORMS.map(
    (platform) =>
      new Worker<RunJobData>(
        runsQueueName(platform),
        async (job) => {
          const startedAt = Date.now();
          let responseId: string | null;
          try {
            responseId = await executeRunJob(db, job.data, mode);
          } catch (error) {
            // Повторяется только «слишком часто»: такой отказ не тарифицируется.
            // Любой другой сбой мог стоить денег, и повтор оплатил бы его дважды.
            if (isRateLimited(error)) throw error;
            throw new UnrecoverableError(error instanceof Error ? error.message : String(error));
          }
          logger.info("run.job_completed", {
            platform,
            runId: job.data.runId,
            promptId: job.data.promptId,
            sampleIndex: job.data.sampleIndex,
            responseId,
            durationMs: Date.now() - startedAt,
          });
          return { responseId };
        },
        { connection, limiter: PLATFORM_RATE_LIMITS[platform], concurrency: 4 },
      ),
  );

  for (const worker of [tickWorker, finalizeWorker, ...runWorkers]) {
    worker.on("failed", (job, error) => {
      // Отказ «слишком часто», после которого будет повтор, — не потеря.
      if (job && isRateLimited(error) && job.attemptsMade < (job.opts.attempts ?? 1)) return;
      // Упавшая задача — единственное место, где теряются измерения:
      // она должна доехать до Sentry, а не остаться строкой в консоли.
      errorReporter.captureError(error, {
        scope: "worker.job",
        queue: worker.name,
        jobId: job?.id,
        attemptsMade: job?.attemptsMade,
        data: job?.data,
      });
    });
  }

  // Проходы подбора не накладываются: медленный проход не должен встретиться
  // со следующим на одном и том же прогоне (claim спас бы от двойной
  // постановки, но лишняя работа и шум в логах ни к чему).
  let pickingUp = false;
  async function pickUp(): Promise<void> {
    if (pickingUp) return;
    pickingUp = true;
    try {
      const result = await pickUpPendingRuns(db, flow, mode);
      if (result.queuedRuns > 0 || result.failedRuns.length > 0 || result.expiredRuns.length > 0) {
        logger.info("runs.picked_up", { ...result });
      }
      for (const runId of result.failedRuns) {
        errorReporter.captureError(new Error(`Could not enqueue run ${runId}`), {
          scope: "runs.pickup",
          runId,
        });
      }
    } catch (error) {
      errorReporter.captureError(error, { scope: "runs.pickup" });
    } finally {
      pickingUp = false;
    }
  }
  await pickUp();
  const pickupTimer = setInterval(() => void pickUp(), PICKUP_EVERY_MS);

  logger.info("worker.started", {
    adapters: mode,
    tickEverySec: TICK_EVERY_MS / 1000,
    pickupEverySec: PICKUP_EVERY_MS / 1000,
    runQueues: PLATFORMS,
  });

  let shuttingDown = false;
  async function shutdown(signal: string): Promise<void> {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info("worker.shutdown", { signal });
    clearInterval(pickupTimer);

    await Promise.all([
      tickWorker.close(),
      finalizeWorker.close(),
      ...runWorkers.map((w) => w.close()),
    ]);
    await Promise.all([
      flow.close(),
      tickQueue.close(),
      queues.runs.close(),
      queues.parse.close(),
      queues.aggregate.close(),
    ]);
    await closeDb();
    connection.disconnect();
    process.exit(0);
  }

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

main().catch((error: unknown) => {
  errorReporter.captureError(error, { scope: "worker.startup" });
  process.exit(1);
});
