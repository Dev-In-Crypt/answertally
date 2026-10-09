import type { Instrumentation } from "next";

/**
 * Точка входа наблюдаемости для web.
 *
 * Импорт динамический и только для nodejs-рантайма: репортер пишет в
 * process.stderr, которого в edge нет. Edge у нас — только middleware, и
 * там нечему падать (чистая проверка пути).
 */

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { logger, errorReportingTarget, ENVIRONMENT, RELEASE } =
    await import("@/server/observability");
  logger.info("web.started", {
    errorReporting: errorReportingTarget,
    environment: ENVIRONMENT,
    release: RELEASE,
  });
}

/** Серверные ошибки рендера и route handlers. */
export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { errorReporter } = await import("@/server/observability");
  const { requestIdFrom, scrubUrl } = await import("@repo/core");

  errorReporter.captureError(error, {
    scope: "web.request",
    /**
     * Путь приходит с токеном в себе: `/r/<токен>` — это сам доступ к отчёту
     * клиента агентства. Общая чистка строк его не снимает (голый путь не
     * похож на URL), поэтому он чистится здесь, до отчёта.
     */
    path: scrubUrl(request.path),
    method: request.method,
    /**
     * Единственное, что берётся из заголовков. Целиком их слать нельзя —
     * там кука сессии и Authorization, — но без идентификатора серверную
     * ошибку не сопоставить со строкой лога балансировщика.
     */
    requestId: requestIdFrom(request.headers),
    routerKind: context.routerKind,
    routePath: context.routePath,
    renderSource: context.renderSource,
  });
};
