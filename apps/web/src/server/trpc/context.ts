import type { Database } from "@repo/db";
import { auth } from "@/lib/auth";
import { db } from "../db";

export type UserRole = "owner" | "admin" | "member";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  agencyId: string | null;
  role: UserRole;
}

export interface TrpcContext {
  db: Database;
  user: SessionUser | null;
}


/** Собирает контекст из заголовков запроса. Используется и в route handler, и в тестах. */
export async function createContext({ headers }: { headers: Headers }): Promise<TrpcContext> {
  const session = await auth.api.getSession({ headers });

  if (!session) {
    return { db, user: null };
  }

  const raw = session.user as { id: string; email: string; name: string } & {
    agencyId?: string | null;
    role?: string | null;
  };

  return {
    db,
    user: {
      id: raw.id,
      email: raw.email,
      name: raw.name,
      agencyId: raw.agencyId ?? null,
      role: (raw.role ?? "member") as UserRole,
    },
  };
}

/** Контекст для тестов и серверных вызовов без HTTP. */
export function createDirectContext(user: SessionUser | null): TrpcContext {
  return { db, user };
}
