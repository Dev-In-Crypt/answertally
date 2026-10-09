import { describe, expect, it } from "vitest";
import {
  isSensitiveKey,
  REDACTED,
  REDACTED_EMAIL,
  scrubEvent,
  scrubFields,
  scrubString,
  scrubValue,
} from "./scrub";

/**
 * Значения здесь выдуманные и по форме похожи на настоящие: тест проверяет,
 * что скраббер узнаёт форму. Ни одного живого ключа в файле нет.
 */

describe("scrubString", () => {
  const cases: Array<{ name: string; input: string; expected: string }> = [
    {
      name: "адрес почты",
      input: "invite failed for anna.smith+tag@agency.example",
      expected: `invite failed for ${REDACTED_EMAIL}`,
    },
    {
      name: "несколько адресов в одной строке",
      input: "from a@b.co to c@d.io",
      expected: `from ${REDACTED_EMAIL} to ${REDACTED_EMAIL}`,
    },
    {
      name: "Bearer-токен",
      input: "Authorization: Bearer abcdefghijklmnop failed",
      expected: `Authorization: ${REDACTED} failed`,
    },
    {
      name: "Basic-авторизация",
      input: "sent Basic dXNlcjpwYXNzd29yZA==",
      expected: `sent Basic ${REDACTED}`,
    },
    {
      name: "JWT",
      input: "token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.c2lnbmF0dXJl here",
      expected: `token ${REDACTED} here`,
    },
    {
      name: "ключ с узнаваемым префиксом",
      input: "stripe rejected sk_test_51NotARealKeyAtAll",
      expected: `stripe rejected ${REDACTED}`,
    },
    {
      name: "пара ключ-значение через двоеточие",
      input: "password: hunter2",
      expected: `password: ${REDACTED}`,
    },
    {
      name: "пара ключ-значение в json",
      input: '{"api_key":"abc123def456"}',
      expected: `{"api_key":${REDACTED}}`,
    },
    {
      name: "куки",
      input: "cookie=session_value_here; path=/",
      expected: `cookie=${REDACTED}; path=/`,
    },
    {
      name: "значения параметров запроса, имена остаются",
      input: "GET https://app.example/api/upload?token=abc&email=x@y.co failed",
      expected: `GET https://app.example/api/upload?token=${REDACTED}&email=${REDACTED} failed`,
    },
    {
      name: "обычный путь не трогается",
      input: "GET https://app.example/clients/42 failed",
      expected: "GET https://app.example/clients/42 failed",
    },
    {
      name: "токен отчёта в пути: ссылка даёт доступ, значит это секрет",
      input: "GET https://app.example/r/9f2b7c1d4e6a8b3f failed",
      expected: `GET https://app.example/r/${REDACTED} failed`,
    },
    {
      name: "токен приглашения в пути",
      input: "open https://app.example/invite/9f2b7c1d4e6a8b3f",
      expected: `open https://app.example/invite/${REDACTED}`,
    },
    {
      name: "голый путь отчёта в тексте, без схемы и хоста",
      input: "render failed at /r/9f2b7c1d4e6a8b3f/icon",
      expected: `render failed at /r/${REDACTED}/icon`,
    },
    {
      name: "голый путь приглашения в начале строки и в кавычках",
      input: `/invite/abc123 then "/r/Xy7Kp2Qr9T"`,
      expected: `/invite/${REDACTED} then "/r/${REDACTED}"`,
    },
    {
      name: "похожий сегмент внутри другого пути не трогается",
      input: "GET /api/r/list and /clients/invite/new",
      expected: "GET /api/r/list and /clients/invite/new",
    },
    {
      name: "случайная строка в пути чужого маршрута тоже снимается",
      input: "GET https://app.example/share/Xy7Kp2Qr9Tv4Bn6Lm3 failed",
      expected: `GET https://app.example/share/${REDACTED} failed`,
    },
    {
      name: "id ресурса остаётся: по нему ищут, доступа он не даёт",
      input: "GET https://app.example/clients/550e8400-e29b-41d4-a716-446655440000/measure failed",
      expected: "GET https://app.example/clients/550e8400-e29b-41d4-a716-446655440000/measure failed",
    },
    {
      name: "длинное имя маршрута словом остаётся",
      input: "GET https://app.example/proposal-template failed",
      expected: "GET https://app.example/proposal-template failed",
    },
    {
      name: "имя файла в стеке остаётся целиком",
      input: "at https://app.example/_next/static/chunks/4f2a9b8c1d3e5f7a.js:1:1",
      expected: "at https://app.example/_next/static/chunks/4f2a9b8c1d3e5f7a.js:1:1",
    },
    {
      name: "ключ xAI узнаётся по префиксу",
      input: "xai request failed with xai-abc123def456ghi",
      expected: `xai request failed with ${REDACTED}`,
    },
    {
      name: "названный предел: безымянный ключ без префикса не ловится",
      // Ни имени поля, ни префикса, ни разделителя — от обычного id такую
      // строку не отличить. Записано в шапке scrub.ts как предел замысла.
      input: "auth failed for key a1b2c3d4e5f6a7b8c9d0",
      expected: "auth failed for key a1b2c3d4e5f6a7b8c9d0",
    },
    {
      name: "postgres-строка подключения",
      input: "connect postgres://user:pw@localhost:5432/db?password=secret",
      expected: `connect postgres://user:pw@localhost:5432/db?password=${REDACTED}`,
    },
    {
      name: "обычный текст остаётся как был",
      input: "run 7 failed after 3 attempts",
      expected: "run 7 failed after 3 attempts",
    },
  ];

  for (const testCase of cases) {
    it(testCase.name, () => {
      expect(scrubString(testCase.input)).toBe(testCase.expected);
    });
  }

  it("чистка идемпотентна — повторный проход ничего не портит", () => {
    const once = scrubString("mail me at a@b.co with token=abc123def");
    expect(scrubString(once)).toBe(once);
    // Уже снятый токен в голом пути не превращается в `[redacted]]`.
    const path = scrubString("at /r/9f2b7c1d4e6a8b3f and /invite/abc123");
    expect(scrubString(path)).toBe(path);
  });
});

describe("isSensitiveKey", () => {
  it("узнаёт имена секретов в любом написании", () => {
    for (const key of [
      "password",
      "Password",
      "api_key",
      "apiKey",
      "API-KEY",
      "authorization",
      "cookie",
      "set-cookie",
      "accessToken",
      "refresh_token",
      "stripeSecret",
      "SENTRY_DSN",
      "email",
      "userEmail",
    ]) {
      expect(isSensitiveKey(key), key).toBe(true);
    }
  });

  it("не трогает счётчики и идентификаторы", () => {
    // Подстрочное совпадение вычистило бы стоимость прогона — цифры,
    // ради которых в отчёт и смотрят.
    for (const key of [
      "tokensIn",
      "tokensOut",
      "maxTokens",
      "totalTokens",
      "runId",
      "promptId",
      "platform",
      "costUsd",
      "authorName",
      "pinnedAt",
    ]) {
      expect(isSensitiveKey(key), key).toBe(false);
    }
  });
});

describe("scrubValue", () => {
  it("ключ с префиксом в массиве строк снимается, безымянный — нет", () => {
    // Оба лежат без имени поля, решает только форма. `xai-` узнаётся,
    // голая шестнадцатеричная строка — нет: это названный предел скраббера.
    expect(scrubValue(["9f2b7c1d4e6a8b3f0000", "xai-abc123def456ghi"])).toEqual([
      "9f2b7c1d4e6a8b3f0000",
      REDACTED,
    ]);
  });

  it("чистит вложенные объекты на любой глубине", () => {
    const input = {
      run: {
        client: {
          contact: { email: "owner@agency.example", name: "Anna" },
          credentials: { apiKey: "abc123def456" },
        },
      },
    };

    expect(scrubValue(input)).toEqual({
      run: {
        client: {
          contact: { email: REDACTED, name: "Anna" },
          credentials: REDACTED,
        },
      },
    });
  });

  it("чистит массивы и объекты внутри них", () => {
    const input = [{ email: "a@b.co", runId: "r1" }, ["plain", "write to c@d.io"]];

    expect(scrubValue(input)).toEqual([
      { email: REDACTED, runId: "r1" },
      ["plain", `write to ${REDACTED_EMAIL}`],
    ]);
  });

  it("разворачивает ошибку и чистит её сообщение и стек", () => {
    const error = new Error("auth failed for admin@agency.example");
    error.stack = "Error: auth failed for admin@agency.example\n    at load (/app/x.ts:1:1)";

    expect(scrubValue(error)).toEqual({
      name: "Error",
      message: `auth failed for ${REDACTED_EMAIL}`,
      stack: `Error: auth failed for ${REDACTED_EMAIL}\n    at load (/app/x.ts:1:1)`,
    });
  });

  it("сохраняет простые типы", () => {
    expect(scrubValue({ n: 1, b: true, nothing: null })).toEqual({ n: 1, b: true, nothing: null });
    expect(scrubValue(42)).toBe(42);
    expect(scrubValue(null)).toBeNull();
    expect(scrubValue(undefined)).toBeUndefined();
  });

  it("приводит к строкам то, что не сериализуется само", () => {
    expect(scrubValue({ big: 10n, when: new Date("2026-01-02T03:04:05.000Z") })).toEqual({
      big: "10",
      when: "2026-01-02T03:04:05.000Z",
    });
    expect(scrubValue({ fn: () => 1 })).toEqual({ fn: "[function]" });
  });

  it("разворачивает Map и Set, вычищая чувствительные ключи", () => {
    const value = {
      headers: new Map([
        ["cookie", "session=abc"],
        ["x-request-id", "req-7"],
      ]),
      recipients: new Set(["a@b.co"]),
    };

    expect(scrubValue(value)).toEqual({
      headers: { cookie: REDACTED, "x-request-id": "req-7" },
      recipients: [REDACTED_EMAIL],
    });
  });

  it("не зацикливается на самоссылках", () => {
    const node: Record<string, unknown> = { name: "root" };
    node["self"] = node;

    expect(scrubValue(node)).toEqual({ name: "root", self: "[circular]" });
  });

  it("не разворачивает один и тот же объект как цикл, если он встречается дважды", () => {
    const shared = { runId: "r1" };
    expect(scrubValue({ a: shared, b: shared })).toEqual({
      a: { runId: "r1" },
      b: { runId: "r1" },
    });
  });

  it("останавливается на пределе глубины", () => {
    const deep = { a: { b: { c: { d: { e: "too far" } } } } };
    expect(scrubValue(deep, { maxDepth: 3 })).toEqual({ a: { b: { c: "[depth limit]" } } });
  });

  it("обрезает слишком длинные строки", () => {
    const result = scrubValue("x".repeat(100), { maxStringLength: 10 }) as string;
    expect(result.startsWith("xxxxxxxxxx…[truncated 90]")).toBe(true);
  });

  it("экземпляр чужого класса отдаётся описанием, а не полями", () => {
    class Connection {
      constructor(readonly password = "hunter2") {}
      toString(): string {
        return "Connection(secret hidden)";
      }
    }

    expect(scrubValue(new Connection())).toBe("Connection(secret hidden)");
  });
});

describe("scrubFields", () => {
  it("вычищает по имени поля и по содержимому значения", () => {
    expect(
      scrubFields({
        scope: "web.request",
        authorization: "Bearer abcdefghij",
        note: "ping owner@agency.example",
        runId: "r1",
        skipped: undefined,
      }),
    ).toEqual({
      scope: "web.request",
      authorization: REDACTED,
      note: `ping ${REDACTED_EMAIL}`,
      runId: "r1",
    });
  });
});

describe("scrubEvent", () => {
  it("снимает заголовки, куки и тело запроса целиком", () => {
    const event = {
      request: {
        url: "https://app.example/api?token=abc",
        headers: { cookie: "session=abc", authorization: "Bearer abcdefghij" },
        cookies: { session: "abc" },
        data: { password: "hunter2" },
        method: "POST",
      },
    };

    expect(scrubEvent(event)).toEqual({
      request: { url: `https://app.example/api?token=${REDACTED}`, method: "POST" },
    });
  });

  it("токен в пути request.url снимается, остальной путь остаётся", () => {
    expect(scrubEvent({ request: { url: "https://app.example/r/9f2b7c1d4e6a8b3f" } })).toEqual({
      request: { url: `https://app.example/r/${REDACTED}` },
    });
  });

  it("токен в пути навигационной крошки снимается", () => {
    // Сюда `/r/<токен>` приходит голым путём: на URL он не похож, и общей
    // чисткой строк не снимается — за этим отдельный проход по крошкам.
    expect(
      scrubEvent({
        breadcrumbs: [
          { category: "navigation", data: { to: "/r/9f2b7c1d4e6a8b3f", from: "/clients" } },
        ],
      }),
    ).toEqual({
      breadcrumbs: [{ category: "navigation", data: { to: `/r/${REDACTED}`, from: "/clients" } }],
    });
  });

  it("отдельная крошка чистится так же, как крошка внутри события", () => {
    // Браузерный beforeBreadcrumb зовёт scrubEvent на одной крошке.
    expect(
      scrubEvent({ category: "navigation", data: { to: "/invite/9f2b7c1d4e6a8b3f" } }),
    ).toEqual({ category: "navigation", data: { to: `/invite/${REDACTED}` } });
  });

  it("от пользователя остаётся только идентификатор", () => {
    const event = { user: { id: "u1", email: "a@b.co", username: "anna", ip_address: "1.2.3.4" } };
    expect(scrubEvent(event)).toEqual({ user: { id: "u1" } });
  });

  it("пользователь без идентификатора уходит целиком", () => {
    expect(scrubEvent({ user: { email: "a@b.co" }, message: "boom" })).toEqual({ message: "boom" });
  });

  it("чистит сообщение, extra и кадры стека", () => {
    const event = {
      message: "failed for a@b.co",
      extra: { apiKey: "abc123", nested: { note: "token=xyz123abc" } },
      exception: {
        values: [
          {
            type: "Error",
            value: "bad login for a@b.co",
            stacktrace: { frames: [{ filename: "/app/x.ts", vars: { password: "hunter2" } }] },
          },
        ],
      },
    };

    expect(scrubEvent(event)).toEqual({
      message: `failed for ${REDACTED_EMAIL}`,
      extra: { apiKey: REDACTED, nested: { note: `token=${REDACTED}` } },
      exception: {
        values: [
          {
            type: "Error",
            value: `bad login for ${REDACTED_EMAIL}`,
            stacktrace: { frames: [{ filename: "/app/x.ts", vars: { password: REDACTED } }] },
          },
        ],
      },
    });
  });
});
