import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { PageHeader } from "@/components/page-header";
import { ApiKeysView } from "./api-keys-view";

export default async function ApiPage() {
  const session = await auth.api.getSession({ headers: await headers() });
  const role = (session?.user as { role?: string } | undefined)?.role;

  return (
    <>
      <PageHeader
        title="API"
        description="Read-only access to your own numbers, for your dashboard or your weekly deck. Nothing here can change data or start a measurement."
      />
      <ApiKeysView canManage={role === "owner" || role === "admin"} />
    </>
  );
}
