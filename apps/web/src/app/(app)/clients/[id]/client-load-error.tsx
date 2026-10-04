"use client";

import { PageHeader } from "@/components/page-header";
import { buttonClass } from "@/components/ui/button";

/**
 * Клиент не загрузился. «Не найден» — только когда сервер так и ответил
 * (чужой клиент тоже приходит как NOT_FOUND и не отличим от удалённого).
 * Сбой сети или сервера — не удаление: показываем причину и даём повторить.
 *
 * Вызывать как `client.error && !client.data`: упавший фоновый перезапрос
 * не должен прятать уже загруженный экран.
 */
export function ClientLoadError({
  error,
  retry,
}: {
  error: { message: string; data?: { code?: string } | null };
  retry: () => void;
}) {
  if (error.data?.code === "NOT_FOUND") {
    return <PageHeader title="Client not found" description="It may have been removed." />;
  }
  return (
    <div role="alert" data-testid="form-error" className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-8">
      <h2 className="text-base font-medium">This client could not be loaded</h2>
      <p className="max-w-prose text-sm text-muted-foreground">{error.message}</p>
      <button type="button" onClick={retry} className={buttonClass("outline", "lg")}>
        Try again
      </button>
    </div>
  );
}
