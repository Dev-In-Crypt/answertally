import type { PgDatabase } from "drizzle-orm/pg-core";
import { drizzle, type PostgresJsQueryResultHKT } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { requireEnv } from "./env";
import * as schema from "./schema/index";

/**
 * Подключение или транзакция — запросам всё равно, на чём выполняться.
 *
 * Тип общий для обоих, чтобы проверку и запись, которые обязаны идти под
 * одной блокировкой, можно было выполнить теми же функциями внутри
 * `db.transaction(...)`.
 */
export type Database = PgDatabase<PostgresJsQueryResultHKT, typeof schema>;

/**
 * Создаёт подключение. Вызывающий отвечает за close() — важно для тестов и скриптов,
 * иначе процесс не завершается.
 */
export function createDb(url: string = requireEnv("DATABASE_URL")): {
  db: Database;
  close: () => Promise<void>;
} {
  const connection = postgres(url, { max: 10 });
  const db = drizzle(connection, { schema });
  return {
    db,
    close: async (): Promise<void> => {
      await connection.end();
    },
  };
}
