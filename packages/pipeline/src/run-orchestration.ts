import {
  billingPeriod,
  checkWeight,
  getAdapter,
  type AdaptersMode,
  type Platform,
} from "@repo/core";
import { capabilitiesForAgency, platformsForRun } from "@repo/core/config/measurement";
import {
  createResponse,
  countResponsesByRun,
  findSampleResponseId,
  getAgencyIdForRun,
  incrementAiChecks,
  finishRunWithNote,
  getRunById,
  getRunSchedule,
  listActivePromptsForClient,
  logActivity,
  startRun,
  updateResponseStorageKey,
} from "@repo/db";
import type { Database } from "@repo/db";
import { entitlementsForAgency } from "./entitlements";
import { rawResponseKey, storage } from "./storage";
import { storeCitations } from "./parse-job";
import { NO_ACTIVE_PROMPTS_NOTE, runOutcome } from "./finalize-run";

export interface RunJobSpec {
  runId: string;
  promptId: string;
  promptText: string;
  platform: Platform;
  sampleIndex: number;
  /** Носитель расхода: считать AI checks нужно на агентство, а не на клиента. */
  agencyId?: string;
}

/**
 * Разворачивает прогон в отдельные единицы работы: промпт × платформа × повтор.
 * Чистая функция — считается и проверяется без БД и без сети.
 *
 * Повторы обязательны: ответы моделей стохастичны, и visibility по одному
 * ответу — это не измерение, а монетка (контракт C3).
 */
export function planRunJobs(
  runId: string,
  prompts: { id: string; text: string }[],
  platforms: readonly Platform[],
  samplesPerPrompt: number,
): RunJobSpec[] {
  if (samplesPerPrompt < 1) {
    throw new Error(`samplesPerPrompt must be >= 1, got ${samplesPerPrompt}`);
  }

  const jobs: RunJobSpec[] = [];
  for (const prompt of prompts) {
    for (const platform of platforms) {
      for (let sampleIndex = 0; sampleIndex < samplesPerPrompt; sampleIndex++) {
        jobs.push({ runId, promptId: prompt.id, promptText: prompt.text, platform, sampleIndex });
      }
    }
  }
  return jobs;
}

/** Выполняет одну единицу работы: вызов адаптера + запись ответа. */
export async function executeRunJob(
  db: Database,
  job: RunJobSpec,
  mode: AdaptersMode = "mock",
): Promise<string | null> {
  // Задачи прогона живут в очереди часами. Агентство, отменившее подписку
  // или вернувшее деньги за это время, не должно дальше тратить наши: иначе
  // «оплатить, набить очередь, отменить» оставляло бы недели вызовов.
  const agencyId = mode === "live" ? (job.agencyId ?? (await getAgencyIdForRun(db, job.runId))) : null;
  if (mode === "live" && (!agencyId || !(await entitlementsForAgency(db, agencyId)).active)) {
    return null;
  }

  // Задачу могут выполнить дважды: воркер упал посреди вызова, и BullMQ
  // отдал её снова. Ответ уже записан — второй платный вызов не нужен.
  const existing = await findSampleResponseId(db, job);
  if (existing) {
    return existing;
  }

  const adapter = getAdapter(job.platform, mode);
  // Номер сэмпла нужен фикстурам, чтобы повторы одного вопроса различались;
  // живые адаптеры его игнорируют.
  const result = await adapter.execute(job.promptText, { sampleIndex: job.sampleIndex });

  const response = await createResponse(db, {
    runId: job.runId,
    promptId: job.promptId,
    platform: job.platform,
    modelVersion: result.modelVersion,
    sampleIndex: job.sampleIndex,
    rawText: result.text,
    latencyMs: Math.round(result.latencyMs),
    // numeric в Postgres принимает строку — иначе теряется точность на дробных центах.
    costUsd: result.costUsd.toFixed(6),
  });

  // Сырой ответ дублируется в storage: парсер со временем меняется,
  // и переобрабатывать нужно оригинал, а не то, что он разобрал (инвариант 6).
  // Ключ проставляется только после успешной записи файла — иначе в БД
  // осталась бы ссылка на несуществующий объект.
  const key = rawResponseKey(job.runId, response.id);
  await storage.put(key, new TextEncoder().encode(result.text), "text/plain; charset=utf-8");
  await updateResponseStorageKey(db, response.id, key);

  // Ссылки приходят от платформы вместе с ответом и дальше нигде не восстановимы,
  // поэтому раскладываются сразу; упоминания разбирает ParseJob.
  await storeCitations(db, response.id, result.citations);

  /**
   * Расход считается после успешной записи: неудавшийся вызов не должен
   * попадать в счёт агентству.
   *
   * Прогон на заглушках в расход не идёт вовсе: ассистента никто не
   * спрашивал, денег он не стоил, и записывать его в израсходованные
   * проверки значит выставлять агентству счёт за то, чего не было. Экран
   * расхода это и так утверждает отдельной строкой — теперь счётчик с ним
   * согласен. Заодно бесплатный аудит не съедает сам себя в демо-режиме.
   */
  if (agencyId) {
    // Дорогой ассистент списывает больше одной проверки (Grok 5, Claude 4).
    await incrementAiChecks(db, agencyId, billingPeriod(), checkWeight(job.platform));
  }

  return response.id;
}

export interface RunOutcome {
  runId: string;
  expected: number;
  written: number;
  failed: number;
  status: "done" | "failed";
}

/**
 * Полный прогон последовательно, без очередей. Используется тестами и ручным запуском;
 * в проде те же единицы работы раскладываются по очередям BullMQ.
 */
export async function orchestrateRun(
  db: Database,
  runId: string,
  mode: AdaptersMode = "mock",
): Promise<RunOutcome> {
  const run = await getRunById(db, runId);
  if (!run) {
    throw new Error(`Run ${runId} not found`);
  }

  const schedule = run.scheduleId ? await getRunSchedule(db, run.scheduleId) : undefined;
  const agencyId = await getAgencyIdForRun(db, runId);

  /**
   * Без расписания берём набор, который тариф даёт новому клиенту.
   *
   * Не литерал: с тех пор как тарифы развели по ассистентам, общего
   * умолчания не существует — на младшем тарифе оно одно, на старших
   * другое. Прогон по ассистенту, которого тариф не разрешает, потратил бы
   * наши деньги на то, за что агентство не платило, и показал бы долю,
   * посчитанную по более широкому знаменателю, чем у соседа на том же плане.
   *
   * Весь набор, а не одна платформа: молча измерить только ChatGPT и
   * показать это как «видимость» — хуже, чем потратить больше, потому что
   * агентство не узнало бы, что охват неполный.
   */
  /**
   * Не только тариф, но и платит ли агентство.
   *
   * До первой оплаты набор уже: Grok стоит дороже всех и в бесплатный
   * аудит не входит. Брать отсюда один `plan` значило бы платить за него
   * любому, кто завёл аккаунт на выдуманный адрес.
   */
  const entitlements = agencyId
    ? await entitlementsForAgency(db, agencyId)
    : { plan: "starter" as const, paying: false };
  const capabilities = capabilitiesForAgency(entitlements);
  // Кого спросить — решает одна функция для всех путей прогона: здесь, в
  // очереди воркера и в подсчёте проверок перед стартом (см. её описание).
  const platforms = platformsForRun(capabilities, schedule?.platforms);
  const samples = schedule?.samplesPerPrompt ?? 3;

  const prompts = await listActivePromptsForClient(db, run.clientId);
  const jobs = planRunJobs(runId, prompts, platforms, samples).map((job) => ({ ...job, agencyId }));

  await startRun(db, runId);

  let failed = 0;
  for (const job of jobs) {
    try {
      await executeRunJob(db, job, mode);
    } catch (error) {
      failed++;
      console.error(`[worker] job failed (${job.platform}, sample ${job.sampleIndex}):`, error);
    }
  }

  const written = await countResponsesByRun(db, runId);
  // То же правило, что у сборки в воркере: неполный прогон с большинством
  // ответов — done с пометкой, сколько не дошло; без вопросов — failed с
  // причиной, а не безымянным сбоем.
  const { status, note } =
    jobs.length === 0
      ? { status: "failed" as const, note: NO_ACTIVE_PROMPTS_NOTE }
      : runOutcome(written, jobs.length);
  await finishRunWithNote(db, runId, status, note);

  if (agencyId) {
    await logActivity(db, {
      agencyId,
      clientId: run.clientId,
      // Прогон по расписанию делает система, а не человек.
      actorUserId: null,
      eventType: "run_finished",
      payload: { runId, status, answers: written, expected: jobs.length, failed },
    });
  }

  return { runId, expected: jobs.length, written, failed, status };
}
