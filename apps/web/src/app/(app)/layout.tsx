import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAgencyById } from "@repo/db";
import { auth } from "@/lib/auth";
import { AppShell } from "@/components/app-shell";
import { ClientErrorReporting } from "@/components/client-error-reporting";
import { db } from "@/server/db";

/** Общий каркас всех защищённых экранов: сессия проверяется здесь, а не в каждой странице. */
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await auth.api.getSession({ headers: await headers() });

  if (!session) {
    redirect("/login");
  }

  const agencyId = (session.user as { agencyId?: string }).agencyId;
  let agencyName = "Your agency";
  if (agencyId) {
    agencyName = (await getAgencyById(db, agencyId))?.name ?? agencyName;
  }

  return (
    <AppShell agencyName={agencyName} userEmail={session.user.email}>
      {/* Сбор ошибок — только на экранах агентства: см. комментарий в корневом layout. */}
      <ClientErrorReporting />
      {children}
    </AppShell>
  );
}
