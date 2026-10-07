import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { getAgencyById } from "@repo/db";
import { auth } from "@/lib/auth";
import { toRole } from "@/lib/role";
import { RoleProvider } from "@/lib/role-context";
import { AppShell } from "@/components/app-shell";
import { ClientErrorReporting } from "@/components/client-error-reporting";
import { db } from "@/server/db";
import { Analytics } from "@/components/analytics";

/** Общий каркас всех защищённых экранов: сессия проверяется здесь, а не в каждой странице. */
// Рабочее место за входом: в выдачу поисковиков ему не место.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const requestHeaders = await headers();
  const session = await auth.api.getSession({ headers: requestHeaders });

  if (!session) {
    // Адрес страницы кладёт middleware: после входа человек вернётся туда,
    // куда шёл по ссылке, а не на дашборд. Проверяет его /login (safeNextPath).
    const path = requestHeaders.get("x-pathname");
    redirect(path ? `/login?next=${encodeURIComponent(path)}` : "/login");
  }

  const role = toRole((session.user as { role?: unknown }).role);
  const agencyId = (session.user as { agencyId?: string }).agencyId;
  let agencyName = "Your agency";
  if (agencyId) {
    agencyName = (await getAgencyById(db, agencyId))?.name ?? agencyName;
  }

  return (
    <RoleProvider role={role}>
      <AppShell agencyName={agencyName} userEmail={session.user.email}>
        {/* Сбор ошибок — только на экранах агентства: см. комментарий в корневом layout. */}
        <ClientErrorReporting />
        {children}
        <Analytics />
      </AppShell>
    </RoleProvider>
  );
}
