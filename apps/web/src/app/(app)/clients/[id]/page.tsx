"use client";

import { use } from "react";
import { api } from "@/trpc/react";
import { ClientOverview } from "./overview";
import { ClientLoadError } from "./client-load-error";

export default function ClientOverviewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const client = api.clients.get.useQuery({ id });

  if (client.isPending) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  // Чужой клиент отдаётся как NOT_FOUND — интерфейс не подтверждает его существование.
  if (client.error && !client.data) {
    return <ClientLoadError error={client.error} retry={() => client.refetch()} />;
  }

  /**
   * Заголовка здесь нет намеренно: имя клиента и домен уже стоят во вкладках,
   * а «Overview / Where this client stands right now» повторяло вкладку своим
   * же словом и отодвигало первую цифру на треть экрана вниз.
   */
  return <ClientOverview clientId={id} />;
}
