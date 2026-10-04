"use client";

import { createAuthClient } from "better-auth/react";
import type { AuthClientError } from "@/lib/auth-client-messages";

export const authClient = createAuthClient({
  baseURL: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
});

export const { signIn, signUp, signOut, useSession } = authClient;

/**
 * Вызов клиента входа, который не бросает.
 *
 * Ответ сервера с ошибкой клиент возвращает в `result.error`, а упавшую сеть
 * — исключением, и формы оставались на «Please wait…» без единого слова.
 * Здесь сеть становится такой же ошибкой (`status: 0`), и её показывает тот
 * же `authErrorMessage`.
 */
export async function settled<T>(
  call: Promise<T>,
): Promise<T | { data: null; error: AuthClientError }> {
  try {
    return await call;
  } catch {
    return { data: null, error: { status: 0 } };
  }
}
