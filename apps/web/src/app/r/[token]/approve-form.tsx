"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api } from "@/trpc/react";
import { buttonClass } from "@/components/ui/button";
import { controlClass } from "@/components/ui/field";
import { cn } from "@/lib/utils";

/**
 * Подтверждение отчёта клиентом агентства. Без регистрации: аккаунт ради
 * одной кнопки — это ровно то, из-за чего клиент не открывает отчёт вовсе.
 */
export function ApproveForm({ token }: { token: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Отозванную или истёкшую ссылку повтор не оживит: кнопку гасим и говорим,
  // что делать, вместо бесконечного «попробуйте ещё раз».
  const [linkGone, setLinkGone] = useState(false);

  const approve = api.publicReport.approve.useMutation({
    onSuccess: () => router.refresh(),
    onError: (failure) => {
      if (failure.data?.code === "NOT_FOUND") {
        setLinkGone(true);
        setError("This link is no longer valid, so the approval wasn't recorded. Ask for a fresh link.");
      } else {
        setError("Could not record the approval. Please try again.");
      }
    },
  });

  return (
    <div className="mx-auto w-full max-w-3xl px-6 pb-12">
      <form
        data-testid="approve-form"
        onSubmit={(event) => {
          event.preventDefault();
          setError(null);
          approve.mutate({ token, name: name.trim() });
        }}
        className="flex flex-wrap items-end gap-3 rounded-lg border p-5"
      >
        <label className="flex flex-1 flex-col gap-1.5">
          <span className="text-sm font-medium">Approve this report</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={200}
            placeholder="Your name"
            aria-label="Your name"
            className={cn(controlClass, "h-10 px-3")}
          />
        </label>

        <button
          type="submit"
          disabled={!name.trim() || approve.isPending || linkGone}
          className={buttonClass("primary", "lg")}
        >
          {approve.isPending ? "Recording…" : "Approve"}
        </button>

        {error && (
          <p role="alert" data-testid="approve-error" className="w-full text-sm text-destructive">
            {error}
          </p>
        )}
      </form>
    </div>
  );
}
