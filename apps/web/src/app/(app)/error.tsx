"use client";

import { startTransition, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { buttonClass } from "@/components/ui/button";
import { reportClientError } from "@/components/client-error-reporting";
import { SUPPORT_EMAIL } from "@/config/site";

/**
 * Сбой экрана агентства. Boundary стоит внутри `(app)/layout`, поэтому
 * навигация остаётся на месте: человек может уйти на другой экран, а не
 * упирается в пустую страницу.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  const router = useRouter();

  useEffect(() => {
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
    <div
      role="alert"
      className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-8"
    >
      <h1 className="text-lg font-semibold tracking-tight">This screen could not be loaded</h1>
      <p className="max-w-prose text-sm text-muted-foreground">
        Something went wrong on our side. Try again, or write to{" "}
        <a href={`mailto:${SUPPORT_EMAIL}`} className="underline underline-offset-4">
          {SUPPORT_EMAIL}
        </a>
        {error.digest ? ` and mention reference ${error.digest}.` : "."}
      </p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={retry} className={buttonClass("primary", "lg")}>
          Try again
        </button>
        <Link href="/dashboard" className={buttonClass("outline", "lg")}>
          Back to Today
        </Link>
      </div>
    </div>
  );
}
