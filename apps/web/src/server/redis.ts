import IORedis from "ioredis";

/**
 * Подключение к Redis на процесс — только для того, что не обязано работать.
 *
 * Веб без Redis остаётся рабочим: очередь принадлежит воркеру, а здесь он
 * нужен ограничителю частоты, который при его отсутствии считает в памяти.
 * Поэтому адрес читается лениво и отсутствие переменной не ошибка.
 */
let client: IORedis | null | undefined;

export function getRedis(): IORedis | null {
  if (client !== undefined) {
    return client;
  }

  const url = process.env["REDIS_URL"]?.trim();
  if (!url) {
    client = null;
    return client;
  }

  client = new IORedis(url, {
    maxRetriesPerRequest: 1,
    // Недоступный Redis не должен держать запрос: вызывающий переходит
    // на счёт в памяти, и лучше сделать это сразу.
    connectTimeout: 1000,
    // Подвисший, но подключённый Redis (fsync, fork) не должен держать
    // каждый запрос входа: через полсекунды счётчик уходит в память.
    commandTimeout: 500,
    lazyConnect: false,
    enableOfflineQueue: false,
  });

  client.on("error", (error) => {
    console.error("[redis] connection error", error.message);
  });

  return client;
}

/** Подменяется в тестах, чтобы не требовать поднятой очереди. */
export function setRedis(next: IORedis | null): void {
  client = next;
}
