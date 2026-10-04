"use client";

import Link from "next/link";
import { api } from "@/trpc/react";
import { ASK_ADMIN_TO_ADD_CLIENT } from "@/lib/role";
import { useCan } from "@/lib/role-context";
import { EmptyState } from "@/components/page-header";
import { buttonClass } from "@/components/ui/button";
import { SkeletonCards } from "@/components/ui/skeleton";
import { Users } from "lucide-react";

export function ClientsView() {
  const clients = api.clients.list.useQuery();
  const canAddClient = useCan("admin");
  // Доля берётся из той же сводки, что и главная: две разные цифры одного
  // клиента на соседних экранах хуже, чем любая из них.
  const portfolio = api.clients.portfolio.useQuery();
  const visibility = new Map(
    (portfolio.data ?? []).map((row) => [
      row.clientId,
      row.sufficient && row.visibilityPct !== null ? `${Math.round(row.visibilityPct)}%` : "—",
    ]),
  );
  /**
   * Сколько у клиента настроено, но больше не спрашивается.
   *
   * Это справочник настроек клиента, и сломанная настройка здесь на месте.
   * Но «чем заняться» продукт отвечает на экране «Сегодня» — здесь поэтому
   * метка и ссылка на починку, а не строка в общем счёте ожидающего: два
   * счёта одного и того же однажды разойдутся.
   */
  const dropped = new Map(
    (portfolio.data ?? []).map((row) => [row.clientId, row.droppedAssistants]),
  );

  if (clients.isPending) {
    return <SkeletonCards count={4} />;
  }

  if (clients.error) {
    return (
      <p role="alert" data-testid="form-error" className="text-sm text-destructive">
        {clients.error.message}
      </p>
    );
  }

  if (!clients.data || clients.data.length === 0) {
    return (
      <EmptyState
        title="No clients yet"
        icon={Users}
        description={
          canAddClient
            ? "Add your first client to start measuring how often AI assistants mention them, and where competitors show up instead."
            : ASK_ADMIN_TO_ADD_CLIENT
        }
        action={
          canAddClient && (
            <Link
              href="/clients/new"
              className={buttonClass("primary", "lg")}
            >
              Add client
            </Link>
          )
        }
      />
    );
  }

  return (
    <ul data-testid="clients-list" className="grid gap-3 sm:grid-cols-2">
      {clients.data.map((client) => (
        <li key={client.id}>
          <Link
            href={`/clients/${client.id}`}
            className="flex h-full flex-col gap-3 rounded-lg border bg-card p-4 transition-colors hover:bg-accent"
          >
            <div className="flex flex-col gap-0.5">
              <span className="flex items-center gap-2">
                <span className="font-medium">{client.name}</span>
                {(dropped.get(client.id) ?? 0) > 0 && (
                  <span
                    data-testid={`schedule-dropped-${client.id}`}
                    className="rounded-full bg-destructive/10 px-2 py-0.5 text-xs text-destructive"
                    title="Assistants in this client's schedule are no longer measured. Open Measure to fix the schedule."
                  >
                    schedule needs a fix
                  </span>
                )}
                {client.status === "prospect" && (
                  <span
                    data-testid="prospect-badge"
                    className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground"
                  >
                    prospect
                  </span>
                )}
              </span>
              <span className="text-sm text-muted-foreground">{client.domain}</span>
            </div>

            <div className="flex gap-6 text-sm">
              <div className="flex flex-col">
                <span className="text-muted-foreground">Named in answers</span>
                {/* Прочерк — и пока нет замера, и пока замер ниже порога сэмплов:
                    число там было бы догадкой. */}
                <span
                  data-testid={`client-visibility-${client.id}`}
                  className="metric text-lg font-semibold"
                >
                  {visibility.get(client.id) ?? "—"}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="text-muted-foreground">Competitors</span>
                <span className="metric text-lg font-semibold">
                  {client.competitorNames.length}
                </span>
              </div>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
