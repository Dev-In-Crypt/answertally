import Link from "next/link";
import { PageHeader } from "@/components/page-header";
import { ClientsView } from "./clients-view";
import { buttonClass } from "@/components/ui/button";
import { RoleGate } from "@/lib/role-context";

export default function ClientsPage() {
  return (
    <>
      <PageHeader
        title="Clients"
        description="Every client you manage, with the brands and competitors you track for them."
        action={
          // Заводят клиентов админ и владелец (clients.create).
          <RoleGate min="admin">
            <Link
              href="/clients/new"
              className={buttonClass("primary", "lg")}
            >
              Add client
            </Link>
          </RoleGate>
        }
      />
      <ClientsView />
    </>
  );
}
