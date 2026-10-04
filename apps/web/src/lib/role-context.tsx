"use client";

import { createContext, useContext } from "react";
import { roleAtLeast, type Role } from "./role";

// По умолчанию — самая узкая роль: экран вне провайдера не покажет лишнего.
const RoleContext = createContext<Role>("member");

export function RoleProvider({ role, children }: { role: Role; children: React.ReactNode }) {
  return <RoleContext.Provider value={role}>{children}</RoleContext.Provider>;
}

/** true, если роль пользователя не ниже `minimum`. */
export function useCan(minimum: Role): boolean {
  return roleAtLeast(useContext(RoleContext), minimum);
}

/** Для серверных страниц, где хук недоступен: дети — только при достаточной роли. */
export function RoleGate({
  min,
  fallback = null,
  children,
}: {
  min: Role;
  fallback?: React.ReactNode;
  children: React.ReactNode;
}) {
  return useCan(min) ? children : fallback;
}
