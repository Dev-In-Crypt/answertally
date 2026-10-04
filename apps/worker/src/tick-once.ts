import "./env";
import { FlowProducer } from "bullmq";
import { createDb } from "@repo/db";
import { parseAdaptersMode, registerLiveAdapters } from "@repo/core";
import { ADAPTERS_MODE_RAW } from "./env";
import { createConnection } from "./queues";
import { tickSchedules } from "./scheduler";
import { enqueueRun } from "./enqueue-run";

/**
 * Один тик планировщика вручную.
 *
 * Нужен для проверки: обычный тик ходит раз в пять минут, и ждать его,
 * чтобы увидеть ошибку постановки задач, — плохой способ отлаживать то,
 * от чего зависят все замеры.
 */
async function main(): Promise<void> {
  const mode = parseAdaptersMode(ADAPTERS_MODE_RAW);
  // enqueueRun спрашивает только ассистентов с подключённым адаптером —
  // без регистрации здесь каждый живой прогон закрывался бы «никто не доступен».
  if (mode === "live") registerLiveAdapters();
  const connection = createConnection();
  const { db, close } = createDb();
  const flow = new FlowProducer({ connection });

  try {
    const { started, skipped } = await tickSchedules(db, new Date(), mode);
    console.log(`[tick] due schedules: ${started.length + skipped.length}`);

    for (const schedule of skipped) {
      console.warn(`[tick] schedule ${schedule.scheduleId} skipped: ${schedule.reason}`);
    }

    for (const result of started) {
      try {
        const queued = await enqueueRun(db, flow, result.runId, result.clientId);
        console.log(`[tick] run ${result.runId}: queued ${queued} jobs`);
      } catch (error) {
        console.error(`[tick] run ${result.runId} failed to enqueue:`, error);
      }
    }
  } finally {
    await flow.close();
    await close();
    connection.disconnect();
  }
}

const isDirectRun = process.argv[1]?.replace(/\\/g, "/").endsWith("/tick-once.ts") ?? false;
if (isDirectRun) {
  main().catch((error: unknown) => {
    console.error("[tick] failed:", error);
    process.exit(1);
  });
}
