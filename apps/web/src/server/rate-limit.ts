import { getRedis } from "./redis";

/**
 * Счётчик частоты с фиксированным окном: счёт в Redis, если он есть.
 *
 * В памяти процесса счётчик считал бы каждый инстанс отдельно и обнулялся бы
 * при каждом деплое — предъявленный лимит тихо умножался бы. Redis в
 * развёртывании уже стоит: очередь воркера без него не работает.
 *
 * Без Redis остаётся счёт в памяти: разработка и тесты не должны требовать
 * поднятой очереди, а один процесс считает себя правильно. Недоступный Redis
 * тоже ведёт в память, а не в отказ: хуже отключить агентству работу из-за
 * перезапуска очереди, чем пропустить лишний запрос.
 */

const local = new Map<string, { count: number; resetAt: number }>();

function hitLocal(key: string, max: number, windowSeconds: number, now: number): boolean {
  const entry = local.get(key);
  if (!entry || now >= entry.resetAt) {
    local.set(key, { count: 1, resetAt: now + windowSeconds * 1000 });
    return true;
  }
  entry.count += 1;
  return entry.count <= max;
}

/**
 * Засчитать одно событие по ключу. `true` — в пределах `max` за окно.
 *
 * Окно привязано к часам, а не к первому событию: так двум инстансам не нужно
 * договариваться, когда оно началось.
 */
export async function hit(
  key: string,
  max: number,
  windowSeconds: number,
  now: number = Date.now(),
): Promise<boolean> {
  const redis = getRedis();
  if (!redis) {
    return hitLocal(key, max, windowSeconds, now);
  }

  const windowKey = `rate:${key}:${Math.floor(now / (windowSeconds * 1000))}`;
  try {
    const count = await redis.incr(windowKey);
    if (count === 1) {
      await redis.expire(windowKey, windowSeconds * 2);
    }
    return count <= max;
  } catch (error) {
    console.error("[rate-limit] fell back to memory", error);
    return hitLocal(key, max, windowSeconds, now);
  }
}

/** Только для тестов: счётчик в памяти живёт в процессе. */
export function resetRateLimit(): void {
  local.clear();
}
