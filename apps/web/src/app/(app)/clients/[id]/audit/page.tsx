"use client";

import { use } from "react";
import { api } from "@/trpc/react";
import { PageHeader } from "@/components/page-header";
import { AuditView } from "./audit-view";

export default function AuditPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  // Та же проверка, что у соседних экранов: по старой ссылке на удалённого
  // клиента экран звал «Generate prompts» и вёл в тупик.
  const client = api.clients.get.useQuery({ id });

  if (client.error) {
    return <PageHeader title="Client not found" description="It may have been removed." />;
  }

  return (
    <>
      <PageHeader
        title="Run audit"
        description="One measurement pass, then straight to the diagnosis. Nothing is published anywhere — the audit only reads what assistants already answer."
      />
      <AuditView clientId={id} />
    </>
  );
}
