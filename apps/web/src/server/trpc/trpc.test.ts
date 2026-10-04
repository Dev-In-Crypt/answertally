import { describe, expect, it } from "vitest";
import { TRPCError } from "@trpc/server";
import { fetchRequestHandler } from "@trpc/server/adapters/fetch";
import { z } from "zod";
import { INTERNAL_ERROR_MESSAGE, protectedProcedure, publicProcedure, router, userFacingMessage } from "./trpc";

/**
 * Что человек видит вместо ошибки: ни JSON zod, ни голого кода, ни текста
 * драйвера базы. Проверка идёт и на функции, и через настоящий HTTP-ответ —
 * иначе форматтер можно забыть подключить, а функция продолжит проходить тесты.
 */

function zodFailure(schema: z.ZodType, input: unknown): TRPCError {
  const result = schema.safeParse(input);
  if (result.success) throw new Error("ожидалась ошибка разбора");
  return new TRPCError({ code: "BAD_REQUEST", cause: result.error });
}

describe("userFacingMessage", () => {
  it.each([
    ["своё сообщение схемы", z.object({ domain: z.string().refine((v) => v.includes("."), "Enter a domain, for example acme.com") }), { domain: "acme" }, "Enter a domain, for example acme.com"],
    ["пустое обязательное поле", z.object({ name: z.string().min(1).max(200) }), { name: "" }, "Name is required."],
    ["слишком длинное поле", z.object({ name: z.string().max(200) }), { name: "x".repeat(201) }, "Name is too long (max 200 characters)."],
    ["неверная почта", z.object({ email: z.email() }), { email: "john@acme" }, "Enter a valid email address, for example name@agency.com."],
    ["дробное вместо целого", z.object({ retainerUsd: z.number().int().positive() }), { retainerUsd: 2500.5 }, "Retainer (USD) must be a whole number."],
    ["число вне диапазона", z.object({ samplesPerPrompt: z.number().int().min(3).max(10) }), { samplesPerPrompt: 15 }, "Samples per prompt must be at most 10."],
    ["пропущенное поле", z.object({ clientId: z.string() }), {}, "Client ID is required."],
  ])("%s", (_name, schema, input, expected) => {
    expect(userFacingMessage(zodFailure(schema, input))).toBe(expected);
  });

  it("сообщение не содержит JSON zod", () => {
    const message = userFacingMessage(zodFailure(z.object({ email: z.email() }), { email: "x" }));
    expect(message).not.toMatch(/[[{]|"code"|pattern/);
  });

  it.each([
    ["UNAUTHORIZED", "Your session has ended. Sign in again."],
    ["FORBIDDEN", "You don't have permission to do this. Ask the agency owner."],
    ["NOT_FOUND", "This was not found. It may have been removed."],
  ] as const)("голый %s получает человеческий текст", (code, expected) => {
    expect(userFacingMessage(new TRPCError({ code }))).toBe(expected);
  });

  it("намеренный текст остаётся, в том числе у внутренней ошибки", () => {
    expect(userFacingMessage(new TRPCError({ code: "FORBIDDEN", message: "Only the owner can remove an admin." }))).toBe(
      "Only the owner can remove an admin.",
    );
    expect(
      userFacingMessage(new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Payments are not connected yet." })),
    ).toBe("Payments are not connected yet.");
  });

  it("текст драйвера базы заменяется общей фразой", () => {
    const wrapped = new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      cause: new Error("write CONNECT_TIMEOUT postgres:5432"),
    });
    expect(userFacingMessage(wrapped)).toBe(INTERNAL_ERROR_MESSAGE);
  });

  it("ошибка разбора внутри процедуры — сбой сервера, а не подсказка к форме", () => {
    const inner = z.object({ a: z.string() }).safeParse({});
    const wrapped = new TRPCError({ code: "INTERNAL_SERVER_ERROR", cause: inner.error });
    expect(userFacingMessage(wrapped)).toBe(INTERNAL_ERROR_MESSAGE);
  });
});

describe("errorFormatter в HTTP-ответе", () => {
  const testRouter = router({
    create: publicProcedure.input(z.object({ name: z.string().min(1) })).mutation(() => "ok"),
    crash: publicProcedure.query(() => {
      throw new Error("Failed query: select * from clients params: 42");
    }),
  });

  async function call(path: string, init: RequestInit): Promise<{ message: string; code: string }> {
    const response = await fetchRequestHandler({
      endpoint: "/api/trpc",
      req: new Request(`http://localhost/api/trpc/${path}`, init),
      router: testRouter,
      createContext: () => ({ db: null as never, user: null }),
    });
    const body = (await response.json()) as { error: { json: { message: string; data: { code: string } } } };
    return { message: body.error.json.message, code: body.error.json.data.code };
  }

  it("ввод не прошёл схему — одна фраза", async () => {
    const result = await call("create", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ json: { name: "" } }),
    });
    expect(result).toEqual({ code: "BAD_REQUEST", message: "Name is required." });
  });

  it("исключение в процедуре не раскрывает внутренности", async () => {
    const result = await call("crash", { method: "GET" });
    expect(result).toEqual({ code: "INTERNAL_SERVER_ERROR", message: INTERNAL_ERROR_MESSAGE });
  });

  it("вход без агентства — FORBIDDEN, а не UNAUTHORIZED: иначе круг /login ↔ /dashboard", async () => {
    const guarded = router({ me: protectedProcedure.query(() => "ok") });
    const response = await fetchRequestHandler({
      endpoint: "/api/trpc",
      req: new Request("http://localhost/api/trpc/me"),
      router: guarded,
      createContext: () => ({
        db: null as never,
        user: { id: "u1", email: "a@b.test", name: "A", agencyId: null, role: "member" as const },
      }),
    });
    const body = (await response.json()) as { error: { json: { data: { code: string } } } };
    expect(body.error.json.data.code).toBe("FORBIDDEN");
  });
});
