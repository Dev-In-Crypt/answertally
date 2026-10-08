"use client";

import { use } from "react";
import { api } from "@/trpc/react";
import { PageHeader } from "@/components/page-header";
import { DiagnoseView } from "./diagnose-view";
import { CategoryIndex } from "./category-index";
import { ClientLoadError } from "../client-load-error";

export default function DiagnosePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const client = api.clients.get.useQuery({ id });

  if (client.error && !client.data) {
    return <ClientLoadError error={client.error} retry={() => client.refetch()} />;
  }

  return (
    <>
      <PageHeader
        title="Diagnose"
        description="Which sources shape the answers, who appears in them, and where the client is missing."
      />
      <DiagnoseView clientId={id} />
      <div className="mt-6">
        <CategoryIndex clientId={id} />
      </div>
    </>
  );
}
