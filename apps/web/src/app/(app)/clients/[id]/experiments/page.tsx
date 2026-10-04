"use client";

import { use } from "react";
import { api } from "@/trpc/react";
import { PageHeader } from "@/components/page-header";
import { ExperimentsView } from "./experiments-view";
import { ClientLoadError } from "../client-load-error";

export default function ExperimentsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const client = api.clients.get.useQuery({ id });

  if (client.error && !client.data) {
    return <ClientLoadError error={client.error} retry={() => client.refetch()} />;
  }

  return (
    <>
      <PageHeader
        title="Experiments"
        description="What was done, when, and what happened afterwards — shown against a comparison group."
      />
      <ExperimentsView clientId={id} />
    </>
  );
}
