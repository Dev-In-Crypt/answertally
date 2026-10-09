import * as Sentry from "@sentry/node";
import {
  combineErrorReporters,
  createEventThrottle,
  createLogger,
  createLoggingErrorReporter,
  describeError,
  eventThrottleKey,
  resolveReporterIdentity,
  scrubEvent,
  scrubFields,
  sentryBaseOptions,
  type ErrorReporter,
  type Logger,
} from "@repo/core";
import { NODE_ENV, SENTRY_DSN } from "./env";

/**
 * Логи и ошибки воркера.
 *
 * Ошибки всегда идут в лог, даже когда настроен Sentry: иначе локальная
 * отладка зависит от внешнего сервиса, а отсутствие DSN тихо выключает
 * единственный канал.
 *
 * Без DSN `Sentry.init` не вызывается, сеть не трогается, никуда ничего не
 * уходит, а обработчики падений остаются на месте и пишут только в лог.
 *
 * Чего «без DSN» здесь **не** значит: модуль `@sentry/node` импортируется в
 * любом случае — импорт статический, и побочные эффекты его загрузки (SDK
 * ставит хуки загрузки модулей) происходят всегда. В воркере это безопасно:
 * это отдельный процесс вне сборки Next, и цена — только время старта.
 *
 * Динамический импорт убрал бы и это, но он несовместим с тем, как репортер
 * собирается: `errorReporter` нужен синхронно на верхнем уровне модуля, и
 * ожидание загрузки SDK означало бы очередь событий на время старта — лишний
 * механизм и лишний способ потерять первую же ошибку. Разница того не стоит.
 * В браузере цена другая (чанк в бандле каждой страницы), поэтому там импорт
 * динамический.
 */

/**
 * Версия и окружение читаются из `process.env` напрямую: `env.ts` принадлежит
 * не этому потоку (docs/contracts.md §4), а dotenv к этому моменту уже
 * отработал — он загружается побочным эффектом импорта `./env` выше.
 */
const IDENTITY = resolveReporterIdentity(process.env);

export const logger: Logger = createLogger({
  sink: (line, level) => {
    // stderr для warn/error: в проде их отделяют от обычного потока.
    if (level === "warn" || level === "error") process.stderr.write(`${line}\n`);
    else process.stdout.write(`${line}\n`);
  },
  base: { service: "worker", environment: IDENTITY.environment, release: IDENTITY.release },
  minLevel: NODE_ENV === "production" ? "info" : "debug",
});

/**
 * Потолок отправки в Sentry.
 *
 * Отвалившийся Redis роняет каждую задачу в очереди: без ограничителя один
 * инцидент выжигает квоту за минуту, и следующая — уже другая — поломка не
 * доедет вообще. В логе при этом остаётся всё.
 */
const SENTRY_EVENTS_PER_MINUTE = 30;
const SENTRY_SAME_ERROR_PER_MINUTE = 5;

function createSentryReporter(dsn: string): ErrorReporter {
  const throttle = createEventThrottle({
    limit: SENTRY_EVENTS_PER_MINUTE,
    perKeyLimit: SENTRY_SAME_ERROR_PER_MINUTE,
    windowMs: 60_000,
  });

  Sentry.init({
    ...sentryBaseOptions(dsn, process.env),
    /**
     * Свои обработчики падений процесса стоят ниже и работают одинаково
     * с DSN и без него. Встроенные сняты, чтобы одно падение не приехало
     * в Sentry дважды.
     */
    integrations: (defaults) =>
      defaults.filter(
        (integration) =>
          integration.name !== "OnUncaughtException" && integration.name !== "OnUnhandledRejection",
      ),
    // Последняя проверка перед отправкой: сюда попадает и то, что SDK собрал сам.
    beforeSend: (event) => {
      if (!throttle.accept(eventThrottleKey(event as unknown as Record<string, unknown>))) {
        return null;
      }
      return scrubEvent(event as unknown as Record<string, unknown>) as unknown as typeof event;
    },
    beforeBreadcrumb: (breadcrumb) =>
      scrubEvent(breadcrumb as unknown as Record<string, unknown>) as unknown as typeof breadcrumb,
  });

  return {
    captureError(error, context) {
      const described = describeError(error);
      Sentry.captureException(error instanceof Error ? error : new Error(described.message), {
        // Очередь и имя задачи — тегами: по ним в Sentry фильтруют поломки.
        tags: {
          scope: context.scope,
          ...(typeof context["queue"] === "string" ? { queue: context["queue"] } : {}),
          ...(typeof context["jobName"] === "string" ? { jobName: context["jobName"] } : {}),
        },
        // Контекст задачи содержит её данные: чистится до отправки.
        extra: scrubFields({ ...context }),
      });
    },
  };
}

export const sentryEnabled = SENTRY_DSN !== undefined;

export const errorReporter: ErrorReporter = SENTRY_DSN
  ? combineErrorReporters(createSentryReporter(SENTRY_DSN), createLoggingErrorReporter(logger))
  : createLoggingErrorReporter(logger);

export const errorReportingTarget = sentryEnabled ? "sentry+log" : "log";

if (sentryEnabled) {
  logger.info("observability.sentry_enabled", {
    environment: IDENTITY.environment,
    release: IDENTITY.release,
  });
} else {
  // debug, а не info: без DSN это рабочий режим, а не новость.
  logger.debug("observability.console_only", {
    reason: "SENTRY_DSN is not set; errors go to the log only",
  });
}

export interface ProcessErrorHandlers {
  /** Куда вешать обработчики: `process` в приложении, подставной объект в тесте. */
  on: (
    event: "uncaughtException" | "unhandledRejection",
    listener: (value: unknown) => void,
  ) => void;
  reporter: ErrorReporter;
  /** Что делать после отчёта. По умолчанию — то же, что делает node: выход. */
  onFatal: (error: unknown) => void;
}

/**
 * Падения, которые не поймал ни один `try`.
 *
 * Сейчас их видно только по тому, что контейнер перезапустился: node печатает
 * стек и выходит, а стек остаётся в логе того запуска, который уже не найти.
 * Обработчик не меняет поведения — отчёт, потом тот же выход, — но после него
 * у поломки есть запись.
 */
export function installProcessErrorHandlers(handlers: ProcessErrorHandlers): void {
  let handling = false;

  const handle = (scope: string) => (value: unknown) => {
    // Падение внутри самого обработчика не должно уйти в бесконечный круг.
    if (handling) return;
    handling = true;
    try {
      handlers.reporter.captureError(value, { scope });
    } finally {
      handlers.onFatal(value);
    }
  };

  handlers.on("uncaughtException", handle("worker.uncaughtException"));
  // С зарегистрированным обработчиком node перестаёт падать сам, поэтому
  // выход делается руками: иначе воркер останется жить в неизвестном
  // состоянии и молча перестанет брать задачи.
  handlers.on("unhandledRejection", handle("worker.unhandledRejection"));
}

/** Даёт Sentry дописать очередь событий перед выходом. Без DSN — сразу. */
export async function flushErrorReports(): Promise<void> {
  if (!sentryEnabled) return;
  try {
    await Sentry.flush(2000);
  } catch {
    // Отчёт не уехал — это не повод задержать выход.
  }
}

/** Повторяет поведение node после отчёта: выход с кодом 1. */
async function flushAndExit(): Promise<void> {
  await flushErrorReports();
  process.exit(1);
}

/**
 * Под vitest обработчики не ставятся: они перехватили бы падения самого
 * раннера и завершили процесс вместо отчёта о тесте. Сама функция при этом
 * покрыта тестами через подставной `on`.
 */
if (process.env["VITEST"] === undefined) {
  installProcessErrorHandlers({
    on: (event, listener) => {
      process.on(event, (value: unknown) => {
        listener(value);
      });
    },
    reporter: errorReporter,
    onFatal: () => void flushAndExit(),
  });
}
