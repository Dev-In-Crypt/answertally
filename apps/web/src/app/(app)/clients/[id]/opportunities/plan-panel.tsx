"use client";

import { useState } from "react";
import { api } from "@/trpc/react";
import { buttonClass } from "@/components/ui/button";

/**
 * План на 90 дней.
 *
 * Показывается по кнопке, а не разворачивается сам: это документ для
 * разговора с клиентом, а не ещё один блок на рабочем экране. Собран он из
 * тех же возможностей, что стоят выше, — видно, откуда взялась каждая задача.
 */
export function PlanPanel({ clientId }: { clientId: string }) {
  const [open, setOpen] = useState(false);
  const plan = api.opportunities.plan.useQuery({ clientId }, { enabled: open });

  return (
    <section className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-sm font-medium">90-day plan</h2>
          <p className="max-w-prose text-xs text-muted-foreground">
            Built from the opportunities above: own content first, third-party sources next, then
            re-measurement. Every item carries the gap it came from.
          </p>
        </div>
        <button
          data-testid="generate-plan"
          onClick={() => setOpen((current) => !current)}
          className={buttonClass("outline", "lg", "shrink-0")}
        >
          {open ? "Hide plan" : "Generate 90-day plan"}
        </button>
      </div>

      {open && plan.isPending && <p className="text-sm text-muted-foreground">Building…</p>}

      {open && plan.error && (
        <p role="alert" className="text-sm text-destructive">
          The plan could not be built. {plan.error.message}{" "}
          <button type="button" className="underline" onClick={() => plan.refetch()}>
            Try again
          </button>
        </p>
      )}

      {open && plan.data && plan.data.length === 0 && (
        <p className="text-sm text-muted-foreground">
          Nothing to plan yet. A plan is only worth writing once there are measured gaps to put in
          it.
        </p>
      )}

      {open && plan.data && plan.data.length > 0 && (
        <div data-testid="ninety-day-plan" className="flex flex-col gap-4">
          {plan.data.map((phase) => (
            <div key={phase.key} className="flex flex-col gap-2">
              <h3 className="text-sm font-medium">{phase.title}</h3>
              <ul className="flex flex-col gap-2">
                {phase.tasks.map((task) => (
                  <li key={task.title} className="flex flex-col gap-1 rounded-lg border p-3">
                    <span className="text-sm font-medium">{task.title}</span>
                    <span className="max-w-prose text-sm text-muted-foreground">{task.reason}</span>
                    <span className="text-xs text-muted-foreground">
                      {task.affectedPrompts} tracked{" "}
                      {task.affectedPrompts === 1 ? "question" : "questions"} · evidence:{" "}
                      {task.evidence}
                    </span>
                    <span className="text-xs text-muted-foreground">
                      What we would expect to see: {task.expectedSignal}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
