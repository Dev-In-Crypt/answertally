"use client";

import { use } from "react";
import { api } from "@/trpc/react";
import { PageHeader } from "@/components/page-header";
import { ActionsBoard } from "./actions-board";
import { ClientLoadError } from "../client-load-error";

export default function ActionsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const client = api.clients.get.useQuery({ id });

  if (client.error && !client.data) {
    return <ClientLoadError error={client.error} retry={() => client.refetch()} />;
  }

  return (
    <>
      <PageHeader
        title="Actions"
        description="The work queue for this client. Every action carries the reason it exists."
      />
      <ActionsBoard clientId={id} />
    </>
  );
}
