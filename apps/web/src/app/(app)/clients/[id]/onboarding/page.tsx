"use client";

import { use } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/trpc/react";
import { ClientLoadError } from "../client-load-error";
import { PageHeader } from "@/components/page-header";
import { GeneratePrompts } from "../measure/generate-prompts";
import { OnboardingSteps, SamplingCost } from "./steps";
import { buttonClass } from "@/components/ui/button";

/**
 * Шаг 2 онбординга: что именно спрашивать за этого клиента.
 *
 * Отдельный экран, а не часть Measure: у нового клиента ещё нет ни промптов,
 * ни расписания, и полный экран измерений в этот момент показывает шесть
 * пустых блоков вместо одного вопроса, на который надо ответить.
 */
export default function OnboardingPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const router = useRouter();
  const utils = api.useUtils();

  const client = api.clients.get.useQuery({ id });
  const prompts = api.prompts.list.useQuery({ clientId: id });

  if (client.error && !client.data) {
    return <ClientLoadError error={client.error} retry={() => client.refetch()} />;
  }

  const savedPrompts = prompts.data?.length ?? 0;

  return (
    <>
      <OnboardingSteps current={2} />

      <PageHeader
        title={`What should we sample for ${client.data?.name ?? "this client"}?`}
        description="Aliases matter more than they look: answers rarely use the legal name. Anything left out here quietly becomes a missing mention later."
      />

      <div className="flex flex-col gap-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="flex flex-col gap-2 rounded-lg border p-4">
            <span className="text-sm font-medium">Brand names</span>
            <div className="flex flex-wrap gap-1.5">
              {(client.data?.brandNames ?? []).map((name) => (
                <span
                  key={name}
                  className="rounded-md bg-client/12 px-2 py-1 text-xs text-foreground"
                >
                  {name}
                </span>
              ))}
              {(client.data?.brandNames ?? []).length === 0 && (
                <span className="text-xs text-muted-foreground">None yet</span>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-2 rounded-lg border p-4">
            <span className="text-sm font-medium">Competitors</span>
            <div className="flex flex-wrap gap-1.5">
              {(client.data?.competitorNames ?? []).map((name) => (
                <span
                  key={name}
                  className="rounded-md bg-competitor/12 px-2 py-1 text-xs text-foreground"
                >
                  {name}
                </span>
              ))}
              {(client.data?.competitorNames ?? []).length === 0 && (
                <span className="text-xs text-muted-foreground">None yet</span>
              )}
            </div>
          </div>
        </div>

        <Link
          href={`/clients/${id}/settings?return=onboarding`}
          className="self-start text-sm font-medium text-primary underline-offset-4 hover:underline"
        >
          Edit names and competitors →
        </Link>

        <GeneratePrompts
          clientId={id}
          industry={client.data?.industry ?? null}
          onSaved={async () => {
            await utils.prompts.list.invalidate({ clientId: id });
          }}
        />

        <div className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
          <SamplingCost clientId={id} prompts={savedPrompts} />
          <button
            type="button"
            data-testid="onboarding-continue"
            disabled={savedPrompts === 0}
            onClick={() => router.push(`/clients/${id}/measure?step=3`)}
            className={buttonClass("primary", "lg")}
          >
            Continue to schedule
          </button>
        </div>
      </div>
    </>
  );
}
