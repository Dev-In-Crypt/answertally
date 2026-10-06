"use client";

import { useState } from "react";
import { api } from "@/trpc/react";
import { buttonClass } from "@/components/ui/button";
import { ADMIN_ONLY_HINT } from "@/lib/role";
import { useCan } from "@/lib/role-context";

/**
 * Что делать с проспектом после аудита.
 *
 * Две вещи, обе — из уже измеренных данных. Первая: кого модели называют в
 * ответах на его вопросы, кроме тех, кого агентство уже отслеживает. Это
 * наблюдение, а не вывод: список конкурентов задаёт, что вообще считается
 * конкурентом в метриках, и менять его должен человек.
 *
 * Вторая: превращение в клиента. Оно ничего не пересобирает — промпты,
 * конкуренты, измерения и найденные возможности уже те же самые строки.
 * Меняется только статус и то, что расписание начинает измерять дальше.
 */
export function ProspectPanel({ clientId }: { clientId: string }) {
  const utils = api.useUtils();
  const client = api.clients.get.useQuery({ id: clientId });
  const suggestions = api.diagnosis.suggestedCompetitors.useQuery({ clientId });
  const [added, setAdded] = useState<string[]>([]);
  const canEdit = useCan("admin");

  const update = api.clients.update.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.clients.get.invalidate({ id: clientId }),
        utils.diagnosis.suggestedCompetitors.invalidate({ clientId }),
      ]);
    },
  });

  if (client.data?.status !== "prospect") return null;

  const fresh = (suggestions.data ?? []).filter(
    (row) => !row.alreadyTracked && !added.includes(row.domain),
  );

  // Тот же потолок, что у формы клиента: 51-й конкурент сервер не примет.
  const competitorCount = client.data?.competitorNames.length ?? 0;
  const full = competitorCount >= 50;

  return (
    <section
      data-testid="prospect-panel"
      className="flex flex-col gap-4 rounded-lg border border-dashed p-4"
    >
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-medium">Prospect</h2>
        <p className="max-w-prose text-sm text-muted-foreground">
          Everything below came out of one measurement pass. Turning this into a client keeps all
          of it: the questions, the competitors, the baseline and the opportunities.
        </p>
      </div>

      {fresh.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">Also named in these answers</h3>
          <p className="text-xs text-muted-foreground">
            Product sites the models cited when answering this client&apos;s questions. Add the ones
            that are genuinely competitors. The list decides what counts as a competitor in every
            figure after this.
          </p>
          <ul data-testid="suggested-competitors" className="flex flex-wrap gap-2">
            {fresh.map((row) => (
              <li key={row.domain}>
                <button
                  disabled={!canEdit || update.isPending || full}
                  title={canEdit ? `Track as “${row.name}”` : ADMIN_ONLY_HINT}
                  onClick={() => {
                    setAdded((current) => [...current, row.domain]);
                    update.mutate(
                      {
                        id: clientId,
                        competitorNames: [...(client.data?.competitorNames ?? []), row.name],
                      },
                      // Не записалось — чип возвращается, чтобы можно было повторить.
                      {
                        onError: () =>
                          setAdded((current) => current.filter((domain) => domain !== row.domain)),
                      },
                    );
                  }}
                  className={buttonClass("outline", "md", "rounded-full")}
                >
                  + {row.name}
                  <span className="ml-1 text-xs text-muted-foreground">({row.domain})</span>
                  <span className="ml-2 text-xs text-muted-foreground">{row.citations} cited</span>
                </button>
              </li>
            ))}
          </ul>
          {full && (
            <p className="text-xs text-muted-foreground">
              This client already tracks 50 competitors, the most a client can have. Remove one in
              the client settings to add another.
            </p>
          )}
        </div>
      )}

      {canEdit ? (
        <div className="flex flex-wrap items-center gap-3">
          <button
            data-testid="convert-prospect"
            disabled={update.isPending}
            onClick={() => update.mutate({ id: clientId, status: "active" })}
            className={buttonClass("primary", "lg")}
          >
            {update.isPending && update.variables?.status === "active"
              ? "Converting…"
              : "Convert to client"}
          </button>
          <span className="text-xs text-muted-foreground">
            Nothing is rebuilt and nothing is re-measured.
          </span>
        </div>
      ) : (
        // Список конкурентов и статус меняют админ и владелец (clients.update).
        <p className="text-xs text-muted-foreground">{ADMIN_ONLY_HINT}</p>
      )}

      {update.error && (
        <p role="alert" data-testid="form-error" className="text-sm text-destructive">
          {update.error.message}
        </p>
      )}
    </section>
  );
}
