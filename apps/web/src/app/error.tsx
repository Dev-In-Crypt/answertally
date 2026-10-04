"use client";

import { startTransition, useEffect } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { buttonClass } from "@/components/ui/button";
import { reportClientError } from "@/components/client-error-reporting";

/**
 * Сбой страницы под корневым layout: витрина, вход, отчёт клиента `/r/*`.
 *
 * Текст нейтральный, без имени продукта и почты поддержки: этот же экран
 * видит клиент агентства на `/r/<токен>`, а там следа продукта быть не
 * должно (инвариант 3). На остальных страницах добавляется ссылка домой.
 * Экраны агентства ловит свой boundary в `(app)/error.tsx`.
 */
export default function RootError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();
  const isReport = usePathname()?.startsWith("/r/") ?? false;

  useEffect(() => {
    // Репортер сам не шлёт ничего со страницы отчёта клиента.
    void reportClientError(error);
  }, [error]);

  // reset() перерисовывает только клиент; упавшие серверные данные
  // перезапрашивает refresh().
  function retry() {
    startTransition(() => {
      router.refresh();
      reset();
    });
  }

  return (
    <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-start justify-center gap-4 px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">This page could not be loaded</h1>
      <p className="text-sm text-muted-foreground">
        Something went wrong while opening it. Try again in a moment.
      </p>
      {error.digest && (
        <p className="metric text-xs text-muted-foreground">Reference: {error.digest}</p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={retry}
          // Индиго продукта на отчёте агентства — след поставщика.
          className={buttonClass(isReport ? "outline" : "primary", "lg")}
        >
          Try again
        </button>
        {!isReport && (
          <Link href="/" className={buttonClass("outline", "lg")}>
            Go to the home page
          </Link>
        )}
      </div>
    </main>
  );
}
