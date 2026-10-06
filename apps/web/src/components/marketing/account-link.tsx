"use client";

import Link from "next/link";
import { useSession } from "@/lib/auth-client";

/**
 * «Sign in» для гостя, «Dashboard» для вошедшего.
 *
 * Сессия читается на клиенте: серверное чтение заголовков сделало бы
 * динамической каждую страницу витрины. Пока сессия грузится, видна ссылка
 * гостя — для вошедшего она всё равно ведёт в кабинет через страницу входа.
 */
export function AccountLink({ className }: { className?: string }) {
  const { data } = useSession();
  return data ? (
    <Link className={className} href="/dashboard">
      Dashboard
    </Link>
  ) : (
    <Link className={className} href="/login">
      Sign in
    </Link>
  );
}
