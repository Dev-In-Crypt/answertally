import { ButtonLink } from "@/components/ui/button";
import { RoleGate } from "@/lib/role-context";
import { DashboardRail, DecisionFeed } from "./feed";
import { Portfolio } from "./portfolio";

/**
 * Главный экран.
 *
 * Называется «Today», потому что отвечает на вопрос сегодняшнего утра: чем
 * заняться. Сначала лента решений, потом справа расход и состояние прогонов,
 * и только внизу портфель целиком — сводная картина нужна реже, чем список
 * дел, и не должна стоять первой.
 */
export default function DashboardPage() {
  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">Today</h1>
          <p className="max-w-prose text-sm text-muted-foreground">
            What is waiting on a person across your clients. Figures are estimated from repeated
            samples and refresh on each run.
          </p>
        </div>
        {/* Заводят клиентов админ и владелец (clients.create). */}
        <RoleGate min="admin">
          <ButtonLink href="/clients/new" size="lg">
            Add client
          </ButtonLink>
        </RoleGate>
      </div>

      <div className="grid items-start gap-5 lg:grid-cols-[1fr_320px]">
        <DecisionFeed />
        <DashboardRail />
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-sm font-semibold">All clients</h2>
        <Portfolio />
      </section>
    </div>
  );
}
