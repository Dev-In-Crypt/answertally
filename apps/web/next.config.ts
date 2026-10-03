import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextConfig } from "next";

/**
 * Заголовки безопасности для всех страниц.
 *
 * До запуска их не было вовсе. HSTS не даёт увести первый заход на `http`.
 * Запрет встраивания закрывает подмену кликов: панель агентства — отправка
 * отчётов, оплата, команда — открывалась бы в невидимой рамке чужого сайта.
 * Встраивать продукт никуда не нужно, отчёт открывается ссылкой.
 *
 * Полной политики источников здесь нет намеренно: Next вставляет свои
 * встроенные скрипты, и строгая политика сломала бы страницы. Только
 * `frame-ancestors`, которая ничего не ломает.
 */
const SECURITY_HEADERS = [
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      // В адресе клиентского отчёта лежит его токен — по нему отчёт открывается
      // без входа. Переход с отчёта на внешний источник не должен уносить его.
      { source: "/r/:path*", headers: [{ key: "Referrer-Policy", value: "no-referrer" }] },
    ];
  },
  /**
   * Оптимизатор картинок выключен: `next/image` в продукте не используется,
   * а эндпоинт `/_next/image` открыт по умолчанию и дважды за 2026 год был
   * входом для критических уязвимостей. Ненужная поверхность — лишний риск.
   */
  images: { unoptimized: true },
  // Версию движка снаружи знать незачем.
  poweredByHeader: false,
  transpilePackages: ["@repo/core", "@repo/db"],
  typedRoutes: true,
  /**
   * Сборка со своим минимальным node_modules — только в образе.
   *
   * Standalone-вывод раскладывается симлинками, а Windows их без прав
   * разработчика не создаёт: включённый постоянно, он ломает локальную
   * сборку у всех, кто работает не на Linux. В Dockerfile переменная задана.
   */
  ...(process.env["DOCKER_BUILD"] === "1" ? { output: "standalone" as const } : {}),
  // Playwright запускает настоящий браузер и не должен попадать в бандл.
  serverExternalPackages: ["playwright", "playwright-core"],
  // Иначе Next выбирает корнем чужой package-lock.json выше по дереву.
  outputFileTracingRoot: resolve(dirname(fileURLToPath(import.meta.url)), "../.."),
};

export default nextConfig;
