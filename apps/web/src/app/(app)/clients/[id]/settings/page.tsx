"use client";

import { use } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/trpc/react";
import { PageHeader } from "@/components/page-header";
import { ClientForm } from "../../client-form";
import { ClientLoadError } from "../client-load-error";
import { buttonClass } from "@/components/ui/button";
import { ADMIN_ONLY_HINT } from "@/lib/role";
import { useCan } from "@/lib/role-context";

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
  const canEdit = useCan("admin");

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

  // Сбой сети или сервера — не «клиент удалён»: причина и повтор.
  if (client.error && !client.data && client.error.data?.code !== "NOT_FOUND") {
    return <ClientLoadError error={client.error} retry={() => void client.refetch()} />;
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

  // Менять и удалять клиента могут админ и владелец (clients.update/delete):
  // участнику — те же данные без кнопок, которые закончились бы отказом.
  if (!canEdit) {
    const rows: [string, string][] = [
      ["Name", client.data.name],
      ["Domain", client.data.domain],
      ["Industry", client.data.industry || "—"],
      ["Brand names", client.data.brandNames.join(", ") || "—"],
      ["Competitors", client.data.competitorNames.join(", ") || "—"],
    ];
    return (
      <>
        <PageHeader title="Settings" description={ADMIN_ONLY_HINT} />
        <dl data-testid="client-settings-readonly" className="grid max-w-xl gap-3 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="flex flex-col gap-0.5">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="break-words">{value}</dd>
            </div>
          ))}
        </dl>
      </>
    );
  }

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
