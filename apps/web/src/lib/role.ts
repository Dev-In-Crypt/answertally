/**
 * Роль текущего пользователя для интерфейса.
 *
 * Права решает сервер (roleProcedure); здесь только то, что показывать:
 * кнопка, которая заведомо закончится отказом, — это обещание, которое экран
 * не выполнит. Роль приходит из сессии в (app)/layout.tsx — того же источника,
 * что читает сервер, поэтому экран и сервер не расходятся.
 */

export type Role = "owner" | "admin" | "member";

const RANK: Record<Role, number> = { member: 0, admin: 1, owner: 2 };

export function roleAtLeast(role: Role, minimum: Role): boolean {
  return RANK[role] >= RANK[minimum];
}

/** Неизвестная строка из сессии — самая узкая роль: лишняя кнопка хуже недостающей. */
export function toRole(raw: unknown): Role {
  return raw === "owner" || raw === "admin" ? raw : "member";
}

/** Те же фразы, что отвечает сервер на отказ по роли (roleProcedure). */
export const ADMIN_ONLY_HINT =
  "Only an admin or the agency owner can do this. Ask one of them to change your role.";
export const OWNER_ONLY_HINT = "Only the agency owner can do this.";
/** Пустой список клиентов у участника: добавить сам он не может. */
export const ASK_ADMIN_TO_ADD_CLIENT = "Ask an admin or the agency owner to add a client.";
