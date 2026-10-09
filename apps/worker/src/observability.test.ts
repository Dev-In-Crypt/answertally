import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Отчёты об ошибках воркера.
 *
 * SDK подменён: тест не ходит в сеть и не требует ключа. Проверяется то, что
 * ломается молча, — что без DSN ничего не инициализируется, что с DSN уходят
 * правильные настройки, и что из отправки вычищены секреты.
 */

const sentry = vi.hoisted(() => ({
  init: vi.fn(),
  captureException: vi.fn(),
  flush: vi.fn(async () => true),
}));

vi.mock("@sentry/node", () => sentry);

/** Выдуманный DSN: по форме настоящий, ни к какому проекту не ведёт. */
const FAKE_DSN = "https://publickey@o0.ingest.example/1";

interface Captured {
  stdout: string[];
  stderr: string[];
  restore: () => void;
}

function captureOutput(): Captured {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const out = vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    stdout.push(String(chunk));
    return true;
  });
  const err = vi.spyOn(process.stderr, "write").mockImplementation((chunk: unknown) => {
    stderr.push(String(chunk));
    return true;
  });
  return {
    stdout,
    stderr,
    restore: () => {
      out.mockRestore();
      err.mockRestore();
    },
  };
}

beforeEach(() => {
  vi.resetModules();
  sentry.init.mockClear();
  sentry.captureException.mockClear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("без DSN", () => {
  beforeEach(() => {
    vi.stubEnv("SENTRY_DSN", "");
  });

  it("SDK не инициализируется вовсе", async () => {
    const observability = await import("./observability");

    expect(sentry.init).not.toHaveBeenCalled();
    expect(observability.sentryEnabled).toBe(false);
    expect(observability.errorReportingTarget).toBe("log");
  });

  it("в проде загрузка модуля не пишет ни строчки", async () => {
    // Отсутствие DSN — рабочий режим, а не новость: напоминать о нём
    // в каждом запуске воркера незачем.
    vi.stubEnv("NODE_ENV", "production");
    const output = captureOutput();
    await import("./observability");
    output.restore();

    expect(output.stdout).toEqual([]);
    expect(output.stderr).toEqual([]);
  });

  it("captureError всё равно работает — как лог", async () => {
    const { errorReporter } = await import("./observability");
    const output = captureOutput();

    errorReporter.captureError(new Error("redis is down"), { scope: "worker.job", runId: "r1" });
    output.restore();

    expect(output.stderr).toHaveLength(1);
    const record = JSON.parse(output.stderr[0]!) as Record<string, unknown>;
    expect(record).toMatchObject({
      level: "error",
      event: "error.captured",
      service: "worker",
      scope: "worker.job",
      runId: "r1",
      error: "Error",
      message: "redis is down",
    });
    expect(record["fingerprint"]).toMatch(/^[0-9a-f]{8}$/);
  });

  it("в каждую запись попадают окружение и версия", async () => {
    vi.stubEnv("SENTRY_ENVIRONMENT", "staging");
    vi.stubEnv("SENTRY_RELEASE", "2026.09.1");
    const { logger } = await import("./observability");
    const output = captureOutput();

    logger.info("worker.started");
    output.restore();

    expect(JSON.parse(output.stdout[0]!)).toMatchObject({
      environment: "staging",
      release: "2026.09.1",
    });
  });
});

describe("с DSN", () => {
  beforeEach(() => {
    vi.stubEnv("SENTRY_DSN", FAKE_DSN);
    vi.stubEnv("SENTRY_ENVIRONMENT", "staging");
    vi.stubEnv("SENTRY_RELEASE", "abc1234");
  });

  it("инициализируется без PII и без трассировок", async () => {
    const observability = await import("./observability");

    expect(observability.sentryEnabled).toBe(true);
    expect(observability.errorReportingTarget).toBe("sentry+log");
    expect(sentry.init).toHaveBeenCalledTimes(1);
    expect(sentry.init.mock.calls[0]![0]).toMatchObject({
      dsn: FAKE_DSN,
      environment: "staging",
      release: "abc1234",
      sendDefaultPii: false,
      tracesSampleRate: 0,
    });
  });

  it("ошибка уходит и в Sentry, и в лог", async () => {
    const { errorReporter } = await import("./observability");
    const output = captureOutput();

    const error = new Error("job blew up");
    errorReporter.captureError(error, { scope: "worker.job", runId: "r1" });
    output.restore();

    expect(sentry.captureException).toHaveBeenCalledTimes(1);
    const [sent, options] = sentry.captureException.mock.calls[0] as [
      Error,
      { tags: Record<string, string>; extra: Record<string, unknown> },
    ];
    expect(sent).toBe(error);
    expect(options.tags).toEqual({ scope: "worker.job" });
    expect(options.extra).toMatchObject({ scope: "worker.job", runId: "r1" });
    // Лог остаётся вторым каналом: локально ошибку видно без Sentry.
    expect(output.stderr).toHaveLength(1);
  });

  it("очередь и имя задачи уходят тегами", async () => {
    const { errorReporter } = await import("./observability");
    const output = captureOutput();
    errorReporter.captureError(new Error("x"), {
      scope: "worker.job",
      queue: "runs-chatgpt",
      jobName: "sample",
    });
    output.restore();

    const [, options] = sentry.captureException.mock.calls[0] as [Error, { tags: unknown }];
    expect(options.tags).toEqual({ scope: "worker.job", queue: "runs-chatgpt", jobName: "sample" });
  });

  it("контекст задачи вычищается до отправки", async () => {
    const { errorReporter } = await import("./observability");
    const output = captureOutput();

    errorReporter.captureError(new Error("smtp refused"), {
      scope: "worker.job",
      apiKey: "abc123def456",
      data: { recipient: "owner@agency.example" },
    });
    output.restore();

    const [, options] = sentry.captureException.mock.calls[0] as [
      Error,
      { extra: Record<string, unknown> },
    ];
    expect(JSON.stringify(options.extra)).not.toContain("owner@agency.example");
    expect(JSON.stringify(options.extra)).not.toContain("abc123def456");
  });

  it("брошенное не-Error доезжает как Error", async () => {
    const { errorReporter } = await import("./observability");
    const output = captureOutput();
    errorReporter.captureError("string thrown from a library", { scope: "worker.job" });
    output.restore();

    const [sent] = sentry.captureException.mock.calls[0] as [Error];
    expect(sent).toBeInstanceOf(Error);
    expect(sent.message).toBe("string thrown from a library");
  });

  it("beforeSend вычищает событие перед отправкой", async () => {
    await import("./observability");
    const options = sentry.init.mock.calls[0]![0] as {
      beforeSend: (event: Record<string, unknown>) => Record<string, unknown> | null;
    };

    const event = options.beforeSend({
      message: "login failed for owner@agency.example",
      request: { url: "https://app.example/x", headers: { cookie: "session=abc" } },
      user: { id: "u1", email: "owner@agency.example" },
    });

    expect(event).toEqual({
      message: "login failed for [email]",
      request: { url: "https://app.example/x" },
      user: { id: "u1" },
    });
  });

  it("лавина одинаковых ошибок обрывается, квота не выжигается", async () => {
    await import("./observability");
    const options = sentry.init.mock.calls[0]![0] as {
      beforeSend: (event: Record<string, unknown>) => Record<string, unknown> | null;
    };

    const results = Array.from({ length: 20 }, () =>
      options.beforeSend({ exception: { values: [{ type: "Error", value: "redis is down" }] } }),
    );

    expect(results.filter((result) => result !== null).length).toBeLessThan(10);
    expect(results[0]).not.toBeNull();
  });

  it("свои обработчики падений не дублируются встроенными", async () => {
    await import("./observability");
    const options = sentry.init.mock.calls[0]![0] as {
      integrations: (defaults: Array<{ name: string }>) => Array<{ name: string }>;
    };

    const kept = options.integrations([
      { name: "OnUncaughtException" },
      { name: "OnUnhandledRejection" },
      { name: "Http" },
    ]);

    expect(kept.map((integration) => integration.name)).toEqual(["Http"]);
  });
});

describe("installProcessErrorHandlers", () => {
  function fakeProcess() {
    const listeners = new Map<string, (value: unknown) => void>();
    return {
      listeners,
      on: (
        event: "uncaughtException" | "unhandledRejection",
        listener: (value: unknown) => void,
      ) => {
        listeners.set(event, listener);
      },
    };
  }

  it("ловит и необработанное исключение, и отклонённое обещание", async () => {
    const { installProcessErrorHandlers } = await import("./observability");
    const target = fakeProcess();
    const captured: Array<{ scope: string; message: string }> = [];
    const fatal: unknown[] = [];

    installProcessErrorHandlers({
      on: target.on,
      reporter: {
        captureError: (error, context) => {
          captured.push({ scope: context.scope, message: String(error) });
        },
      },
      onFatal: (error) => fatal.push(error),
    });

    target.listeners.get("uncaughtException")?.(new Error("boom"));
    expect(captured).toEqual([{ scope: "worker.uncaughtException", message: "Error: boom" }]);
    expect(fatal).toHaveLength(1);
  });

  it("отклонённое обещание попадает в свой scope", async () => {
    const { installProcessErrorHandlers } = await import("./observability");
    const target = fakeProcess();
    const scopes: string[] = [];

    installProcessErrorHandlers({
      on: target.on,
      reporter: { captureError: (_error, context) => scopes.push(context.scope) },
      onFatal: () => {},
    });

    target.listeners.get("unhandledRejection")?.(new Error("rejected"));
    expect(scopes).toEqual(["worker.unhandledRejection"]);
  });

  it("падение внутри самого обработчика не уходит в круг", async () => {
    const { installProcessErrorHandlers } = await import("./observability");
    const target = fakeProcess();
    let calls = 0;

    installProcessErrorHandlers({
      on: target.on,
      reporter: {
        captureError: () => {
          calls++;
          throw new Error("reporter itself is broken");
        },
      },
      onFatal: () => {},
    });

    // Выход всё равно происходит (onFatal в finally), а второй вызов гасится.
    expect(() => target.listeners.get("uncaughtException")?.(new Error("boom"))).toThrow();
    target.listeners.get("uncaughtException")?.(new Error("again"));
    expect(calls).toBe(1);
  });

  it("под vitest обработчики на настоящий процесс не вешаются", async () => {
    // Иначе они перехватят падения самого раннера и завершат процесс
    // вместо отчёта о тесте.
    const before = process.listenerCount("uncaughtException");
    await import("./observability");
    expect(process.listenerCount("uncaughtException")).toBe(before);
  });
});
