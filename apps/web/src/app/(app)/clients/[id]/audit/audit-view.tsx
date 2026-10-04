"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { api } from "@/trpc/react";
import { EmptyState } from "@/components/page-header";
import { buttonClass } from "@/components/ui/button";
import { SUPPORT_EMAIL } from "@/config/site";
import { MessageSquare } from "lucide-react";

/**
 * Разовый аудит: одна кнопка — и до диагностики без ручных шагов.
 *
 * Шаги показаны списком, а не одной крутилкой: аудит идёт по чужому клиенту,
 * и человеку, который его запустил, важно видеть, где именно он встал, если
 * встал.
 */

const STEPS = [
  { key: "measure", label: "Asking the assistants", detail: "Several samples per prompt" },
  { key: "parse", label: "Reading the answers", detail: "Brand and competitor mentions, cited links" },
  { key: "classify", label: "Classifying the sources", detail: "Which kind of site each citation came from" },
  { key: "aggregate", label: "Working out visibility", detail: "Share of answers, weekly window" },
] as const;

type Phase = "idle" | "running" | "done" | "error" | "stalled";

/**
 * Сколько ждать прогон, прежде чем перестать крутить индикатор.
 *
 * Не дошедший до воркера за десять минут — воркер стоит или очередь забита;
 * идущий дольше трёх четвертей часа — больше самого крупного аудита при
 * лимитах провайдеров. Экран тогда говорит, где смотреть, а не крутится вечно.
 */
const PENDING_LIMIT_MS = 10 * 60 * 1000;
const RUNNING_LIMIT_MS = 45 * 60 * 1000;

const linkClass = "text-primary underline-offset-4 hover:underline";

export function AuditView({ clientId }: { clientId: string }) {
  const router = useRouter();
  const utils = api.useUtils();
  const prompts = api.prompts.list.useQuery({ clientId });
  const plan = api.runs.auditPlan.useQuery({ clientId });
  const runs = api.runs.list.useQuery({ clientId });
  const [phase, setPhase] = useState<Phase>("idle");
  /** Прогон, который выполняет воркер (живой режим); null — выполнен сразу. */
  const [queuedRunId, setQueuedRunId] = useState<string | null>(null);

  async function refresh(): Promise<void> {
    await Promise.all([
      utils.runs.list.invalidate({ clientId }),
      utils.runs.auditPlan.invalidate({ clientId }),
      utils.diagnosis.sourceGraph.invalidate({ clientId }),
      utils.measurement.visibility.invalidate({ clientId }),
    ]);
  }

  /**
   * Идущий замер клиента подхватывается и после перезагрузки страницы.
   * Раньше прогресс жил только в состоянии компонента: вернувшись на экран,
   * человек видел активную кнопку и запускал второй платный аудит.
   */
  const inFlight = runs.data?.find(
    (run) => run.adaptersMode === "live" && (run.status === "pending" || run.status === "running"),
  );
  useEffect(() => {
    if (inFlight && queuedRunId === null && phase === "idle") {
      setQueuedRunId(inFlight.id);
      setPhase("running");
    }
  }, [inFlight, queuedRunId, phase]);

  const audit = api.runs.startAudit.useMutation({
    onMutate: () => setPhase("running"),
    onSuccess: async (result) => {
      /**
       * В живом режиме сервер только создаёт прогон — выполняет его воркер,
       * и это минуты. Раньше экран объявлял «готово» сразу после создания и
       * вёл на пустой список возможностей: аудит, главный путь продажи,
       * выглядел работающим и не делал ничего.
       */
      if (!result.executedInline) {
        setQueuedRunId(result.runId);
        return;
      }
      await refresh();
      setPhase(result.outcome?.status === "failed" ? "error" : "done");
    },
    onError: () => {
      setPhase("error");
      void utils.runs.auditPlan.invalidate({ clientId });
    },
  });

  const queuedRun = api.runs.get.useQuery(
    { id: queuedRunId ?? "" },
    {
      enabled: queuedRunId !== null && phase === "running",
      refetchInterval: (query) => {
        const status = query.state.data?.status;
        return status === "done" || status === "failed" ? false : 5000;
      },
    },
  );

  const status = queuedRun.data?.status;
  const startedAt = queuedRun.data?.startedAt;

  useEffect(() => {
    if (status === "done") {
      void refresh().then(() => setPhase("done"));
    } else if (status === "failed") {
      void refresh().then(() => setPhase("error"));
    }
    // Зависимость — только статус: refresh лишь сбрасывает кэш запросов
    // клиента, и перезапускать эффект из-за новой ссылки на него незачем.
  }, [status]);

  // Крутилка не вечная: прогон, застрявший в очереди или идущий дольше
  // разумного, и потерянная связь с сервером переводят экран в «долго».
  useEffect(() => {
    if (phase !== "running" || !startedAt || (status !== "pending" && status !== "running")) return;
    const limit = status === "pending" ? PENDING_LIMIT_MS : RUNNING_LIMIT_MS;
    const left = new Date(startedAt).getTime() + limit - Date.now();
    const timer = setTimeout(() => setPhase("stalled"), Math.max(0, left));
    return () => clearTimeout(timer);
  }, [phase, status, startedAt]);

  useEffect(() => {
    if (queuedRun.isError && phase === "running") setPhase("stalled");
  }, [queuedRun.isError, phase]);

  // Дойдя до конца, экран сам ведёт к диагностике: аудит не должен
  // заканчиваться вопросом «а дальше куда».
  useEffect(() => {
    if (phase !== "done") return;
    // Аудит ведёт к ранжированной работе, а не к прибору: следующий шаг
    // продажи — «вот что мы нашли и в каком порядке», а не срез по источникам.
    const timer = setTimeout(() => router.push(`/clients/${clientId}/opportunities`), 1200);
    return () => clearTimeout(timer);
  }, [phase, clientId, router]);

  const promptCount = prompts.data?.length ?? 0;

  if (prompts.isPending) {
    return <p className="text-sm text-muted-foreground">Loading…</p>;
  }

  if (promptCount === 0) {
    return (
      <EmptyState
        title="No prompts to audit yet"
        icon={MessageSquare}
        description="An audit measures the questions buyers actually ask. Generate a starting set on the measure screen, edit it, then come back."
        action={
          <Link
            href={`/clients/${clientId}/measure`}
            className={buttonClass("primary", "lg")}
          >
            Generate prompts
          </Link>
        }
      />
    );
  }

  // «Долго» — прогон всё ещё идёт: второй нажатием не запустить (сервер
  // ответит CONFLICT), поэтому кнопка закрыта, как и во время прогона.
  const running = audit.isPending || phase === "running" || phase === "stalled";
  // Отказ известен до клика: о нём говорится заранее, а не после нажатия.
  // После упавшего прогона тоже — повтор, на который не хватит проверок,
  // кнопкой не предлагается.
  const refusal =
    phase === "idle" || (phase === "error" && !audit.error)
      ? (plan.data?.refusal ?? null)
      : null;
  const measureLink = (
    <Link href={`/clients/${clientId}/measure`} className={linkClass}>
      measure screen
    </Link>
  );

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          data-testid="run-audit"
          disabled={running || refusal !== null}
          onClick={() => audit.mutate({ clientId })}
          className={buttonClass("primary", "lg")}
        >
          {running ? "Running audit…" : "Run audit"}
        </button>
        <span className="text-sm text-muted-foreground">
          {plan.data ? (
            <>
              <span className="metric">{plan.data.promptCount}</span> prompts ×{" "}
              <span className="metric">{plan.data.assistants.length}</span> assistants ×{" "}
              <span className="metric">{plan.data.samplesPerPrompt}</span> samples ={" "}
              <span className="metric">{plan.data.checks}</span> AI checks.
            </>
          ) : (
            <>
              <span className="metric">{promptCount}</span> prompts, several samples each.
            </>
          )}{" "}
          Repeated samples are what makes the number readable at all — one answer is not a
          measurement.
        </span>
      </div>

      {refusal && (
        <p data-testid="audit-refusal" className="text-sm text-muted-foreground">
          {refusal}{" "}
          <Link href="/settings/billing" className={linkClass}>
            See plans and usage
          </Link>
          .
        </p>
      )}

      {phase === "error" && (
        <p role="alert" data-testid="form-error" className="text-sm text-destructive">
          {audit.error?.message ??
            queuedRun.data?.note ??
            "The audit could not be completed."}{" "}
          {audit.error ? (
            audit.error.data?.code === "FORBIDDEN" && (
              <Link href="/settings/billing" className={linkClass}>
                See plans and usage.
              </Link>
            )
          ) : (
            <>
              The run is listed on the {measureLink}. If this keeps happening, write to{" "}
              <a href={`mailto:${SUPPORT_EMAIL}`} className={linkClass}>
                {SUPPORT_EMAIL}
              </a>
              .
            </>
          )}
        </p>
      )}

      {phase === "running" && queuedRunId !== null && (
        <p data-testid="audit-queued" className="text-sm text-muted-foreground">
          The assistants are being asked now. This takes a few minutes, because every prompt is
          asked several times on each assistant. You can leave this page — the results appear on
          the opportunities screen when the run finishes.
        </p>
      )}

      {phase === "stalled" && (
        <p data-testid="audit-stalled" className="text-sm text-muted-foreground">
          This audit is taking longer than usual. It keeps going in the background — its status is
          on the {measureLink}, and the results appear on the opportunities screen when it
          finishes.
        </p>
      )}

      <ol data-testid="audit-steps" className="flex flex-col gap-2">
        {STEPS.map((step) => {
          // Отказ, сбой и «долго» — не «все шаги пройдены».
          const state = phase === "running" ? "running" : phase === "done" ? "done" : "waiting";
          const detail =
            step.key === "measure" && plan.data
              ? `${plan.data.assistants.join(", ")} — ${plan.data.samplesPerPrompt} samples per prompt`
              : step.detail;
          return (
            <li
              key={step.key}
              data-testid={`audit-step-${step.key}`}
              data-state={state}
              className="flex items-start gap-3 rounded-lg border p-4"
            >
              <span
                aria-hidden
                className={
                  state === "done"
                    ? "mt-1 size-2.5 shrink-0 rounded-full bg-primary"
                    : state === "running"
                      ? "mt-1 size-2.5 shrink-0 animate-pulse rounded-full bg-primary/60"
                      : "mt-1 size-2.5 shrink-0 rounded-full bg-muted-foreground/30"
                }
              />
              <span className="flex flex-col gap-0.5">
                <span className="text-sm font-medium">{step.label}</span>
                <span className="text-sm text-muted-foreground">{detail}</span>
              </span>
            </li>
          );
        })}
      </ol>

      {phase === "done" && (
        <p data-testid="audit-done" className="text-sm">
          Audit complete —{" "}
          <Link href={`/clients/${clientId}/opportunities`} className={linkClass}>
            open the opportunities
          </Link>
          .
          {queuedRun.data?.note && (
            <span className="text-muted-foreground"> {queuedRun.data.note}</span>
          )}
        </p>
      )}
    </div>
  );
}
