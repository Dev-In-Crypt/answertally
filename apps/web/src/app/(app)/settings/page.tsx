import Link from "next/link";
import { headers } from "next/headers";
import { getAgencyById } from "@repo/db";
import { auth } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { SettingsForm } from "./settings-form";
import { db } from "@/server/db";

export default async function SettingsPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  const agencyId = (session?.user as { agencyId?: string } | undefined)?.agencyId;

  const agency = agencyId ? await getAgencyById(db, agencyId) : undefined;

  return (
    <>
      <PageHeader
        title="Settings"
        description="Agency profile, white-label branding and team. Reports carry your brand, never ours."
        action={
          /* Ключи ушли из навигации: заходят за ними редко, а искать
               их станут здесь — это и есть настройки агентства. */
          <Link
            href="/settings/api"
            className="text-sm text-primary underline-offset-4 hover:underline"
          >
            API keys →
          </Link>
        }
      />
      <SettingsForm
        initialName={agency?.name ?? ""}
        initialColor={agency?.brandColor ?? "#4f46e5"}
        initialLogoUrl={agency?.logoUrl ?? null}
      />
    </>
  );
}
