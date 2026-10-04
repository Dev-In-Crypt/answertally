import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * `unhit` возвращает ровно одно событие в тот же счётчик и то же окно, что
 * засчитал `hit`, — и в памяти, и в Redis. Redis подменён картой.
 */

const store = new Map<string, number>();
let redisOn = false;
vi.mock("./redis", () => ({
  getRedis: () =>
    redisOn
      ? {
          incr: async (key: string) => {
            store.set(key, (store.get(key) ?? 0) + 1);
            return store.get(key);
          },
          decr: async (key: string) => {
            store.set(key, (store.get(key) ?? 0) - 1);
            return store.get(key);
          },
          expire: async () => 1,
          del: async (key: string) => (store.delete(key) ? 1 : 0),
        }
      : null,
}));

const { hit, unhit, resetRateLimit } = await import("./rate-limit");

afterEach(() => {
  resetRateLimit();
  store.clear();
  redisOn = false;
});

describe.each([false, true])("unhit (redis: %s)", (withRedis) => {
  it("возвращённое событие освобождает место под лимитом", async () => {
    redisOn = withRedis;
    const now = Date.UTC(2026, 9, 4, 12);
    expect(await hit("k", 2, 3600, now)).toBe(true);
    expect(await hit("k", 2, 3600, now)).toBe(true);
    await unhit("k", 3600, now);
    expect(await hit("k", 2, 3600, now)).toBe(true);
    expect(await hit("k", 2, 3600, now)).toBe(false);
  });

  it("ниже нуля счёт не уходит", async () => {
    redisOn = withRedis;
    const now = Date.UTC(2026, 9, 4, 12);
    await unhit("k", 3600, now);
    await unhit("k", 3600, now);
    expect(await hit("k", 1, 3600, now)).toBe(true);
    expect(await hit("k", 1, 3600, now)).toBe(false);
    // В Redis не остаётся ключа без срока жизни.
    if (withRedis) expect([...store.values()].every((count) => count > 0)).toBe(true);
  });
});
