"use client";

import { use } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/trpc/react";
import { PageHeader } from "@/components/page-header";
import { MeasureView } from "./measure-view";
import { OnboardingSteps } from "../onboarding/steps";
import { ClientLoadError } from "../client-load-error";

export default function MeasurePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const searchParams = useSearchParams();
  const onboarding = searchParams.get("step") === "3";
  const client = api.clients.get.useQuery({ id });

  if (client.error && !client.data) {
    return <ClientLoadError error={client.error} retry={() => client.refetch()} />;
  }

  return (
    <>
      {/* Шаги показываются только когда сюда пришли из онбординга: на обычном
          заходе «3 из 3» означало бы незаконченную настройку, которой нет. */}
      {onboarding && <OnboardingSteps current={3} />}
      <PageHeader
        title="Measure"
        description={
          client.data
            ? `Buyer questions tracked for ${client.data.name}, grouped into clusters.`
            : "Buyer questions tracked for this client."
        }
      />
      <MeasureView clientId={id} />
    </>
  );
}
