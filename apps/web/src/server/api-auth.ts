import { parseApiKey, verifyApiKey } from "@repo/core";
import { findApiKeyByPrefix, touchApiKey, type Database } from "@repo/db";
import { hit } from "./rate-limit";

/**
 * Авторизация публичного API по ключу агентства.
 *
 * Ответы намеренно скупые: неверный ключ, отозванный ключ и ключ чужого
 * агентства выглядят одинаково. Публичный эндпоинт не должен подсказывать,
 * какая часть предъявленного была верной.
 */

export interface ApiCaller {
  agencyId: string;
  keyId: string;
}

export type ApiAuthResult =
  | { ok: true; caller: ApiCaller }
  | { ok: false; status: 401 | 429; message: string };

const WINDOW_SECONDS = 60;
const MAX_REQUESTS_PER_WINDOW = 120;

export { resetRateLimit } from "./rate-limit";

export async function authenticateApiRequest(
  db: Database,
  request: Request,
): Promise<ApiAuthResult> {
  const header = request.headers.get("authorization") ?? "";
  const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : "";

  // Формат проверяется до похода в базу: неверный ключ не стоит запроса.
  const parsed = token ? parseApiKey(token) : null;
  if (!parsed) {
    return { ok: false, status: 401, message: "Provide a valid API key as a bearer token." };
  }

  const stored = await findApiKeyByPrefix(db, parsed.prefix);
  if (!stored || !(await verifyApiKey(token, stored))) {
    return { ok: false, status: 401, message: "Provide a valid API key as a bearer token." };
  }

  if (!(await hit(`api:${stored.id}`, MAX_REQUESTS_PER_WINDOW, WINDOW_SECONDS))) {
    return { ok: false, status: 429, message: "Too many requests for this key. Try in a minute." };
  }

  await touchApiKey(db, stored.id);

  return { ok: true, caller: { agencyId: stored.agencyId, keyId: stored.id } };
}

export function apiError(status: number, message: string): Response {
  return Response.json({ error: message }, { status });
}

/** Чужой ресурс неотличим от несуществующего — то же правило, что в tRPC. */
export function notFound(): Response {
  return apiError(404, "Not found");
}
