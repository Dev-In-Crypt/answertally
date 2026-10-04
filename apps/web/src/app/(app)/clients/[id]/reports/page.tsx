"use client";

import { use } from "react";
import { api } from "@/trpc/react";
import { ClientLoadError } from "../client-load-error";
import { PageHeader } from "@/components/page-header";
import { ReportsView } from "./reports-view";

export default function ReportsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const client = api.clients.get.useQuery({ id });

  if (client.error && !client.data) {
    return <ClientLoadError error={client.error} retry={() => client.refetch()} />;
  }

  return (
    <>
      <PageHeader
        title="Reports"
        description="Client-facing reports. They carry your agency's brand and nothing else."
      />
      <ReportsView clientId={id} />
    </>
  );
}
