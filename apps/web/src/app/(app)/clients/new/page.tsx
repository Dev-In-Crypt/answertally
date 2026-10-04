"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { Users } from "lucide-react";
import { api } from "@/trpc/react";
import { EmptyState, PageHeader } from "@/components/page-header";
import { buttonClass } from "@/components/ui/button";
import { ADMIN_ONLY_HINT } from "@/lib/role";
import { useCan } from "@/lib/role-context";
import { ClientForm } from "../client-form";
import { OnboardingSteps } from "../[id]/onboarding/steps";

export default function NewClientPage() {
  const router = useRouter();
  const utils = api.useUtils();
  const canAddClient = useCan("admin");

  const create = api.clients.create.useMutation({
    onSuccess: async (client) => {
      await utils.clients.list.invalidate();
      // Заведённый клиент без промптов ничего не измеряет, поэтому следующий
      // шаг открывается сразу, а не ищется потом в списке.
      router.push(`/clients/${client.id}/onboarding`);
      router.refresh();
    },
  });

  // Заводят клиентов админ и владелец: участнику форма закончилась бы отказом
  // уже после того, как он всё заполнил.
  if (!canAddClient) {
    return (
      <>
        <PageHeader title="Add client" />
        <EmptyState
          title="Ask an admin to add this client"
          icon={Users}
          description={ADMIN_ONLY_HINT}
          action={
            <Link href="/clients" className={buttonClass("outline", "lg")}>
              Back to clients
            </Link>
          }
        />
      </>
    );
  }

  return (
    <>
      <OnboardingSteps current={1} />
      <PageHeader
        title="Add client"
        description="Brand names and competitors drive how answers are parsed, so it is worth listing every spelling."
      />
      <ClientForm
        submitLabel="Create client"
        pending={create.isPending}
        error={create.error?.message ?? null}
        onSubmit={(values) =>
          create.mutate({
            name: values.name,
            domain: values.domain,
            industry: values.industry || undefined,
            brandNames: values.brandNames,
            competitorNames: values.competitorNames,
            status: values.isProspect ? "prospect" : "active",
          })
        }
      />
    </>
  );
}
