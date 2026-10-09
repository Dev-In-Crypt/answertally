import {
  createStackParser,
  createTransport,
  nodeStackLineParser,
  Scope,
  ServerRuntimeClient,
} from "@sentry/core";
import {
  combineErrorReporters,
  createEventThrottle,
  createLogger,
  createLoggingErrorReporter,
  describeError,
  eventThrottleKey,
  resolveDsn,
  resolveReporterIdentity,
  scrubEvent,
  scrubFields,
  sentryBaseOptions,
  type ErrorReporter,
  type Logger,
} from "@repo/core";

/**
 * Логи и ошибки серверной части web.
 *
 * Ошибки всегда пишутся структурной строкой в stderr — это канал, который
 * собирает хостинг, и он работает без всякого Sentry. Если задан `SENTRY_DSN`,
 * они дополнительно уходят в Sentry.
 *
 * SDK здесь — голый `@sentry/core`, а не `@sentry/node` или `@sentry/nextjs`.
 * `@sentry/node` инструментирует загрузку модулей через import-in-the-middle;
 * сборщик Next пытается его забандлить и падает на резолве встроенного `path`
 * (dev-сервер отдавал 500 на каждой странице). `@sentry/nextjs` тянет плагин
 * сборки с загрузкой source maps и телеметрией, а сборка у нас герметична.
 * `@sentry/core` — чистый JS без хуков загрузки: клиент, разбор стека, отправка
 * через `fetch`. Трассировки и автоинструментации нет — ловим только ошибки.
 *
 * Без DSN клиент не создаётся, сеть не трогается.
 */

const IDENTITY = resolveReporterIdentity(process.env);

export const { environment: ENVIRONMENT, release: RELEASE } = IDENTITY;

export const logger: Logger = createLogger({
  sink: (line, level) => {
    if (level === "warn" || level === "error") process.stderr.write(`${line}\n`);
    else process.stdout.write(`${line}\n`);
  },
  base: { service: "web", environment: IDENTITY.environment, release: IDENTITY.release },
  // Уровень — по NODE_ENV, а не по имени окружения: `SENTRY_ENVIRONMENT=staging`
  // на боевой сборке не должен включать отладочный поток.
  minLevel: process.env.NODE_ENV === "production" ? "info" : "debug",
});

/** Тот же потолок, что у воркера: один инцидент не должен выжечь квоту. */
const SENTRY_EVENTS_PER_MINUTE = 30;
const SENTRY_SAME_ERROR_PER_MINUTE = 5;

function createSentryReporter(dsn: string): ErrorReporter {
  const throttle = createEventThrottle({
    limit: SENTRY_EVENTS_PER_MINUTE,
    perKeyLimit: SENTRY_SAME_ERROR_PER_MINUTE,
    windowMs: 60_000,
  });

  const client = new ServerRuntimeClient({
    ...sentryBaseOptions(dsn, process.env),
    platform: "node",
    runtime: { name: "node", version: process.version },
    stackParser: createStackParser(nodeStackLineParser()),
    // Никаких автоинтеграций: запрос, заголовки и консоль сами не собираются.
    integrations: [],
    transport: (options) =>
      createTransport(options, async (request) => {
        const response = await fetch(options.url, {
          method: "POST",
          body: request.body as BodyInit,
        });
        return {
          statusCode: response.status,
          headers: {
            "x-sentry-rate-limits": response.headers.get("x-sentry-rate-limits"),
            "retry-after": response.headers.get("retry-after"),
          },
        };
      }),
    // Последняя проверка перед отправкой: заголовки, куки, тело, почта, токены.
    beforeSend: (event) => {
      if (!throttle.accept(eventThrottleKey(event as unknown as Record<string, unknown>))) {
        return null;
      }
      return scrubEvent(event as unknown as Record<string, unknown>) as unknown as typeof event;
    },
  });
  client.init();

  return {
    captureError(error, context) {
      const scope = new Scope();
      scope.setTag("scope", context.scope);
      // Контекст несёт путь и поля запроса: чистится до отправки.
      scope.setExtras(scrubFields({ ...context }));
      client.captureException(
        error instanceof Error ? error : new Error(describeError(error).message),
        undefined,
        scope,
      );
    },
  };
}

const SENTRY_DSN = resolveDsn(process.env);

export const errorReporter: ErrorReporter = SENTRY_DSN
  ? combineErrorReporters(createSentryReporter(SENTRY_DSN), createLoggingErrorReporter(logger))
  : createLoggingErrorReporter(logger);

export const errorReportingTarget = SENTRY_DSN ? "sentry+log" : "log";
