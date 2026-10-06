import { Queue } from "bullmq";
import IORedis from "ioredis";
import type { Platform } from "@repo/core";
import { REDIS_URL } from "./env";

/** BullMQ требует maxRetriesPerRequest: null для блокирующих операций воркера. */
export function createConnection(): IORedis {
  return new IORedis(REDIS_URL, { maxRetriesPerRequest: null });
}

export const QUEUE_NAMES = {
  runs: "runs",
  parse: "parse",
  aggregate: "aggregate",
  /** Сборка прогона: выполняется, когда доехали все его ответы. */
  finalize: "run-finalize",
} as const;

export type QueueName = (typeof QUEUE_NAMES)[keyof typeof QUEUE_NAMES];

export interface RunJobData {
  runId: string;
  promptId: string;
  promptText: string;
  platform: Platform;
  sampleIndex: number;
}

/**
 * Отдельная очередь на платформу. Лимиты у провайдеров разные и считаются
 * независимо, поэтому общий лимитер на одну очередь либо душил бы быструю
 * платформу, либо упирался в 429 у медленной.
 */
export function runsQueueName(platform: Platform): string {
  // Дефис, не двоеточие: BullMQ 6 запрещает ":" в имени очереди (оно идёт в ключи Redis).
  return `${QUEUE_NAMES.runs}-${platform}`;
}

/** Запросов в минуту на платформу. Консервативно: цена ошибки — 429 и потерянный прогон. */
export const PLATFORM_RATE_LIMITS: Record<Platform, { max: number; duration: number }> = {
  // Лимит аккаунта OpenAI — 200 тыс. токенов в минуту, а вопрос с веб-поиском
  // съедает около 23 тыс. (первый живой аудит, 06.10.2026): больше восьми в
  // минуту — уже 429. Поднимать вместе с уровнем аккаунта.
  chatgpt: { max: 8, duration: 60_000 },
  // 30 в минуту при четырёх параллельных задачах упирались в 429 на первом
  // живом аудите (06.10.2026); отказы повторяются, но лучше их не вызывать.
  perplexity: { max: 12, duration: 60_000 },
  gemini: { max: 60, duration: 60_000 },
  // Лимиты новых провайдеров пока неизвестны — берётся консервативная
  // середина. Уточнить по тарифу аккаунта при первом живом прогоне.
  claude: { max: 30, duration: 60_000 },
  grok: { max: 30, duration: 60_000 },
};

export interface FinalizeJobData {
  runId: string;
  clientId: string;
  /**
   * Сколько ответов должно было получиться. Считается в момент постановки
   * задач и едет сюда: пересчёт в момент сборки дал бы другое число, если
   * набор промптов за время прогона изменился.
   */
  expected: number;
  /** Ассистенты, которых прогон не спрашивал: на сервере нет их ключа. */
  unavailable?: Platform[];
}

export interface ParseJobData {
  responseId: string;
}

export interface AggregateJobData {
  clientId: string;
  runId: string;
}

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: "exponential" as const, delay: 2000 },
  removeOnComplete: { count: 1000 },
  removeOnFail: { count: 5000 },
};

export function createQueues(connection: IORedis) {
  return {
    runs: new Queue<RunJobData>(QUEUE_NAMES.runs, { connection, defaultJobOptions }),
    parse: new Queue<ParseJobData>(QUEUE_NAMES.parse, { connection, defaultJobOptions }),
    aggregate: new Queue<AggregateJobData>(QUEUE_NAMES.aggregate, {
      connection,
      defaultJobOptions,
    }),
  };
}

export type Queues = ReturnType<typeof createQueues>;
