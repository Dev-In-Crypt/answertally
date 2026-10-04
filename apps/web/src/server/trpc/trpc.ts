import { initTRPC, TRPCError } from "@trpc/server";
import superjson from "superjson";
import { SUPPORT_EMAIL } from "@/config/site";
import type { TrpcContext, UserRole } from "./context";

/** Сбой на нашей стороне: подробности уходят в лог (onError в route.ts), не на экран. */
export const INTERNAL_ERROR_MESSAGE = `Something went wrong on our side. Try again, or write to ${SUPPORT_EMAIL}.`;

/** Что сказать, если ошибка брошена без своего текста: иначе на экран попадает сам код. */
const DEFAULT_MESSAGES: Partial<Record<TRPCError["code"], string>> = {
  BAD_REQUEST: "Some of the details are not valid. Check the form and try again.",
  UNAUTHORIZED: "Your session has ended. Sign in again.",
  FORBIDDEN: "You don't have permission to do this. Ask the agency owner.",
  NOT_FOUND: "This was not found. It may have been removed.",
  CONFLICT: "This was changed in the meantime. Refresh the page and try again.",
  PAYLOAD_TOO_LARGE: "That is too large. Try a smaller file.",
  TOO_MANY_REQUESTS: "Too many attempts. Wait a minute and try again.",
};

interface ValidationIssue {
  code: string;
  message: string;
  path: PropertyKey[];
  origin?: string;
  format?: string;
  expected?: string;
  minimum?: number | bigint;
  maximum?: number | bigint;
  inclusive?: boolean;
}

/** `retainerUsd` → «Retainer (USD)»: имя поля в схеме — единственное, что про него известно. */
function fieldLabel(path: PropertyKey[]): string | null {
  const key = [...path].reverse().find((part): part is string => typeof part === "string");
  if (!key) return null;
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/\busd\b/, "(USD)")
    .replace(/\burl\b/, "URL")
    .replace(/\bid\b/, "ID");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/**
 * Первая проблема ввода — одной фразой.
 *
 * Своё сообщение схемы («Enter a domain, for example acme.com») идёт как есть.
 * Стандартные тексты zod («Too small: expected string to have >=1 characters»)
 * написаны для разработчика, их заменяет фраза с именем поля.
 */
export function validationMessage(issues: readonly ValidationIssue[]): string {
  const issue = issues[0];
  if (!issue) return DEFAULT_MESSAGES.BAD_REQUEST!;
  if (!/^(Invalid|Too small|Too big|Unrecognized key)/.test(issue.message)) return issue.message;

  const field = fieldLabel(issue.path) ?? "This field";
  const limit = Number(issue.code === "too_small" ? issue.minimum : issue.maximum);
  const isText = issue.origin === "string";
  const isList = issue.origin === "array" || issue.origin === "set";

  switch (issue.code) {
    case "too_small":
      if (isText) return limit <= 1 ? `${field} is required.` : `${field} is too short (min ${limit} characters).`;
      if (isList) return `${field} needs at least ${limit} ${limit === 1 ? "item" : "items"}.`;
      return issue.inclusive === false ? `${field} must be greater than ${limit}.` : `${field} must be at least ${limit}.`;
    case "too_big":
      if (isText) return `${field} is too long (max ${limit} characters).`;
      if (isList) return `${field} allows at most ${limit} ${limit === 1 ? "item" : "items"}.`;
      return issue.inclusive === false ? `${field} must be less than ${limit}.` : `${field} must be at most ${limit}.`;
    case "invalid_format":
      if (issue.format === "email") return "Enter a valid email address, for example name@agency.com.";
      if (issue.format === "url") return `${field} must be a full link, for example https://example.com.`;
      return `${field} is not in the expected format.`;
    case "invalid_type":
      if (issue.message.endsWith("received undefined")) return `${field} is required.`;
      if (issue.expected === "int") return `${field} must be a whole number.`;
      if (issue.expected === "number") return `${field} must be a number.`;
      return `${field} has an invalid value.`;
    default:
      return `${field} has an invalid value.`;
  }
}

function isValidationError(cause: unknown): cause is { issues: ValidationIssue[] } {
  return (
    typeof cause === "object" && cause !== null && Array.isArray((cause as { issues?: unknown }).issues)
  );
}

/**
 * Текст ошибки, который увидит человек.
 *
 * Свой текст есть у ошибок, брошенных намеренно: он остаётся. Без него tRPC
 * подставляет код («FORBIDDEN») или сообщение причины — массив zod в JSON,
 * текст драйвера базы, «Failed query: select …». Ничего из этого на экран
 * не уходит. Ошибка без своего текста узнаётся по тому, что её сообщение
 * совпадает с кодом или с сообщением причины.
 */
export function userFacingMessage(error: TRPCError): string {
  const cause = error.cause;
  const explicit = error.message !== error.code && !(cause && error.message === cause.message);

  if (error.code === "BAD_REQUEST" && isValidationError(cause)) return validationMessage(cause.issues);
  if (explicit) return error.message;
  return DEFAULT_MESSAGES[error.code] ?? INTERNAL_ERROR_MESSAGE;
}

const t = initTRPC.context<TrpcContext>().create({
  transformer: superjson,
  errorFormatter: ({ shape, error }) => ({ ...shape, message: userFacingMessage(error) }),
});

export const router = t.router;
export const publicProcedure = t.procedure;

/**
 * Инвариант 1 (CLAUDE.md): каждый запрос к данным проходит через protectedProcedure.
 * Пользователь без агентства не может читать ничего.
 */
export const protectedProcedure = t.procedure.use(({ ctx, next }) => {
  if (!ctx.user) {
    throw new TRPCError({ code: "UNAUTHORIZED" });
  }
  // Вход есть, агентства нет: UNAUTHORIZED увёл бы на /login, а оттуда
  // живая сессия вернула бы обратно — бесконечный круг редиректов.
  if (!ctx.user.agencyId) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: `Your account is not linked to an agency. Write to ${SUPPORT_EMAIL}.`,
    });
  }

  return next({
    ctx: { ...ctx, user: { ...ctx.user, agencyId: ctx.user.agencyId } },
  });
});

const ROLE_RANK: Record<UserRole, number> = { member: 0, admin: 1, owner: 2 };

/** Процедура, доступная только с ролью не ниже указанной. */
export function roleProcedure(minimum: UserRole) {
  return protectedProcedure.use(({ ctx, next }) => {
    if (ROLE_RANK[ctx.user.role] < ROLE_RANK[minimum]) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message:
          minimum === "owner"
            ? "Only the agency owner can do this."
            : "Only an admin or the agency owner can do this. Ask one of them to change your role.",
      });
    }
    return next();
  });
}

/**
 * Проверка принадлежности ресурса тенанту.
 *
 * Чужой ресурс отдаёт NOT_FOUND, а не FORBIDDEN: FORBIDDEN подтвердил бы,
 * что ресурс с таким id существует. Отсутствующий и чужой должны быть неразличимы.
 */
export function assertTenant(
  resource: { agencyId: string } | null | undefined,
  agencyId: string,
): asserts resource is { agencyId: string } {
  if (!resource || resource.agencyId !== agencyId) {
    throw new TRPCError({ code: "NOT_FOUND" });
  }
}
