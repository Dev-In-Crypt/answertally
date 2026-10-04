"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/trpc/react";
import { PageHeader } from "@/components/page-header";
import { ClientForm } from "../../client-form";
import { buttonClass } from "@/components/ui/button";

export default function EditClientPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ return?: string }>;
}) {
  const { id } = use(params);
  // Из онбординга сюда приходят поправить имена — и туда же возвращаются.
  // Принимается только известное значение, а не произвольный адрес.
  const fromOnboarding = use(searchParams).return === "onboarding";
  const router = useRouter();
  const utils = api.useUtils();

  const client = api.clients.get.useQuery({ id });

  const update = api.clients.update.useMutation({
    onSuccess: async () => {
      await Promise.all([utils.clients.list.invalidate(), utils.clients.get.invalidate({ id })]);
      router.push(fromOnboarding ? `/clients/${id}/onboarding` : "/clients");
      router.refresh();
    },
  });

  const remove = api.clients.delete.useMutation({
    onSuccess: async () => {
      await utils.clients.list.invalidate();
      router.push("/clients");
      router.refresh();
    },
  });

  if (client.isPending) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  // Чужой клиент отдаётся как NOT_FOUND — интерфейс не подтверждает его существование.
  if (client.error || !client.data) {
    return (
      <>
        <PageHeader title="Client not found" description="It may have been removed." />
        <p data-testid="form-error" className="text-sm text-muted-foreground">
          Nothing to show here.
        </p>
      </>
    );
  }

  const clientName = client.data.name;

  return (
    <>
      <PageHeader
        title="Settings"
        description="Name, domain, brand names and competitors — everything measurement matches against."
        action={
          <button
            type="button"
            onClick={() => {
              // Удаление каскадом стирает всю историю клиента, отменить его нельзя.
              if (
                window.confirm(
                  `Delete ${clientName}? All of its measurements, reports, report links, actions and history will be permanently removed. This cannot be undone.`,
                )
              ) {
                remove.mutate({ id });
              }
            }}
            disabled={remove.isPending}
            className={buttonClass("outline", "lg")}
          >
            {remove.isPending ? "Deleting…" : "Delete client"}
          </button>
        }
      />
      {remove.error && (
        <p role="alert" className="mb-4 text-sm text-destructive">
          {remove.error.message}
        </p>
      )}
      <ClientForm
        initial={{
          name: client.data.name,
          domain: client.data.domain,
          industry: client.data.industry ?? "",
          brandNames: client.data.brandNames,
          competitorNames: client.data.competitorNames,
          isProspect: client.data.status === "prospect",
        }}
        submitLabel="Save changes"
        pending={update.isPending}
        error={update.error?.message ?? null}
        onSubmit={(values) =>
          update.mutate({
            id,
            name: values.name,
            domain: values.domain,
            // Пустое поле — явный null: отсутствующий ключ значит «не трогать».
            industry: values.industry || null,
            brandNames: values.brandNames,
            competitorNames: values.competitorNames,
            status: values.isProspect ? "prospect" : "active",
          })
        }
      />
    </>
  );
}
