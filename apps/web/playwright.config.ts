import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { testDatabaseUrl } from "../../packages/db/src/test-database";

const PORT = 3100;
const baseURL = `http://127.0.0.1:${PORT}`;

/**
 * Адрес базы из корневого .env.
 *
 * Конфиг Playwright грузится как CJS, поэтому dotenv-загрузчик из @repo/db
 * сюда не подходит (он на import.meta), а нужна отсюда ровно одна переменная.
 */
function rootDatabaseUrl(): string {
  const fromShell = process.env["DATABASE_URL"];
  if (fromShell) {
    return fromShell;
  }

  const file = resolve(__dirname, "../../.env");
  const line = readFileSync(file, "utf8")
    .split(/\r?\n/)
    .find((row) => row.startsWith("DATABASE_URL="));
  if (!line) {
    throw new Error(`DATABASE_URL is not set and was not found in ${file}`);
  }
  return line.slice("DATABASE_URL=".length).trim().replace(/^["']|["']$/g, "");
}

// Приложение под e2e работает на тестовой базе: прогон делает десятки
// регистраций и пишет в глобальную таблицу источников, и всё это не должно
// оседать в рабочей базе. Саму базу готовит `pnpm --filter @repo/db test:prepare`
// в скрипте e2e — до того, как Playwright поднимет приложение.
const databaseUrl = testDatabaseUrl(rootDatabaseUrl());
// Тот же адрес нужен спекам, которые готовят данные напрямую (e2e/paid-plan.ts).
process.env["E2E_DATABASE_URL"] = databaseUrl;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 60_000,
  reporter: [["list"]],
  use: {
    baseURL,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    // Прогон идёт по production-сборке: e2e должен ловить то, что уедет в прод.
    command: `pnpm build && pnpm start --port ${PORT}`,
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    /**
     * Лимит на «собраться и подняться», а не на один тест.
     *
     * Здесь стояло три минуты, и production-сборка в них перестала
     * помещаться — на этой машине она занимает три с небольшим. Лимит ниже
     * реального времени сборки не защищает ни от чего: он превращает
     * медленную машину в красный прогон, и разбирать потом приходится не
     * тест, а погоду.
     */
    timeout: 600_000,
    env: {
      BETTER_AUTH_URL: baseURL,
      NEXT_PUBLIC_APP_URL: baseURL,
      // dotenv не перетирает уже заданные переменные, поэтому адрес отсюда
      // сильнее строки из .env — приложение поднимется на тестовой базе.
      DATABASE_URL: databaseUrl,
      // Прогон делает несколько регистраций подряд с одного адреса.
      DISABLE_RATE_LIMIT: "true",
      /**
       * Домен отчётов задан, чтобы e2e проверял его по-настоящему.
       *
       * Переменная попадает в сборку, поэтому задать её только одному
       * серверу нельзя — пришлось бы собирать приложение дважды. Остальным
       * проверкам она не мешает: сравнение идёт по хосту запроса, а они
       * ходят на localhost. Видимая ссылка на отчёт при этом становится
       * полной и ведёт на этот домен — токен из неё берут отрезанием по
       * «/r/», а не по началу строки.
       */
      NEXT_PUBLIC_REPORT_HOST: "client-reports.test",
    },
  },
});
