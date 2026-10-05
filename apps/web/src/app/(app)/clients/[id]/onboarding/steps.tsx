"use client";

import { api } from "@/trpc/react";
import { cn } from "@/lib/utils";

/**
 * Шаги заведения клиента.
 *
 * Показаны целиком, а не по одному: человек, заводящий клиента, должен
 * заранее знать, что после списка вопросов будет расписание, — иначе он
 * бросает продукт на середине, считая, что всё готово.
 */

const STEPS = ["Client", "Prompts & competitors", "Schedule"] as const;

export function OnboardingSteps({ current }: { current: 1 | 2 | 3 }) {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
      <span className="rounded-full bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground">
        {current} of {STEPS.length}
      </span>
      <span className="flex flex-wrap items-center gap-2 text-muted-foreground">
        {STEPS.map((step, index) => (
          <span key={step} className="flex items-center gap-2">
            {index > 0 && <span aria-hidden>·</span>}
            <span className={cn(index + 1 === current && "font-medium text-foreground")}>
              {step}
            </span>
          </span>
        ))}
      </span>
    </div>
  );
}

/**
 * Цена расписания до того, как его сохранили.
 *
 * Продукт тратит деньги агентства на каждый ответ, и сумма должна стоять
 * рядом с настройкой, которая её определяет, а не всплывать в конце месяца
 * на странице расходов.
 */
export function SamplingCost({
  clientId,
  prompts,
  samplesPerPrompt = 3,
  runsPerMonth = 2,
}: {
  clientId: string;
  prompts: number;
  samplesPerPrompt?: number;
  runsPerMonth?: number;
}) {
  /**
   * Оценка — для набора, который тариф даёт новому клиенту.
   *
   * Не общий литерал: наборы у тарифов разные, и считать всем по одному
   * значило бы обещать расход на ассистентов, которых клиенту никто не
   * включал, — или наоборот, промолчать о тех, кто включён.
   */
  const capacity = api.runs.capacity.useQuery({ clientId });
  const assistants = capacity.data?.defaultAssistants.length ?? 0;
  const perRun = prompts * assistants * samplesPerPrompt;
  const perMonth = perRun * runsPerMonth;

  if (prompts === 0 || assistants === 0) {
    return (
      <span className="text-sm text-muted-foreground">
        Save a prompt set to see how many answers a run takes.
      </span>
    );
  }

  // Без оплаты расписания нет, а аудит один: месячный расход здесь был бы
  // ценой того, что бесплатный аккаунт сделать не может.
  if (!capacity.data?.paying) {
    return (
      <span data-testid="sampling-cost" className="metric text-sm text-muted-foreground">
        {prompts} prompts × {assistants} assistants × {samplesPerPrompt} samples ={" "}
        <span className="font-medium text-foreground">{perRun} answers</span> in the free audit
      </span>
    );
  }

  return (
    <span data-testid="sampling-cost" className="metric text-sm text-muted-foreground">
      {prompts} prompts × {assistants} assistants × {samplesPerPrompt} samples ={" "}
      <span className="font-medium text-foreground">{perRun} answers</span> per run ·{" "}
      <span className="font-medium text-foreground">{perMonth}</span> checks a month at the default
      cadence
    </span>
  );
}
