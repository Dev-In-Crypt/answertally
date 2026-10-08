"use client";

import { useState } from "react";
import { ACTION_TYPES, formatDateTime, formatDay } from "@repo/core";
import { api } from "@/trpc/react";
import { EmptyState } from "@/components/page-header";
import { buttonClass } from "@/components/ui/button";
import { controlClass } from "@/components/ui/field";
import { cn } from "@/lib/utils";
import { SkeletonCards, SkeletonText } from "@/components/ui/skeleton";
import { ListChecks } from "lucide-react";

const COLUMNS = [
  { status: "backlog", label: "Backlog" },
  { status: "in_progress", label: "In progress" },
  { status: "done", label: "Done" },
] as const;

type Status = (typeof COLUMNS)[number]["status"] | "dropped";

type ActionRow = {
  id: string;
  title: string;
  reason: string;
  actionType: string;
  estimatedImpact: string;
  effort: string;
  status: string;
  sourceDomain: string | null;
  affectedClusterIds: string[];
  ownerUserId: string | null;
  completedAt: Date | null;
  createdAt: Date;
};

/**
 * Порядок работ: предполагаемая отдача против трудозатрат.
 *
 * Простая и открытая формула, а не скрытый скоринг: агентство должно
 * понимать, почему одна строка выше другой, и иметь право не согласиться.
 */
const IMPACT_RANK: Record<string, number> = { high: 3, medium: 2, low: 1 };
const EFFORT_RANK: Record<string, number> = { low: 3, medium: 2, high: 1 };

function priority(row: { estimatedImpact: string; effort: string }): number {
  return (IMPACT_RANK[row.estimatedImpact] ?? 2) * 2 + (EFFORT_RANK[row.effort] ?? 2);
}

const IMPACT_STYLE: Record<string, string> = {
  high: "bg-client/15 text-foreground",
  medium: "bg-secondary text-muted-foreground",
  low: "bg-secondary text-muted-foreground",
};

interface Member {
  id: string;
  name: string;
  email: string;
}

function ownerName(ownerUserId: string | null, members: Member[] | undefined): string | null {
  if (!ownerUserId) return null;
  const owner = members?.find((member) => member.id === ownerUserId);
  return owner?.name ?? owner?.email ?? "assigned";
}

export function ActionsBoard({ clientId }: { clientId: string }) {
  const utils = api.useUtils();
  const actions = api.actions.list.useQuery({ clientId });
  const members = api.agency.members.useQuery();

  const [selected, setSelected] = useState<ActionRow | null>(null);
  const [dropReason, setDropReason] = useState("");
  const [adding, setAdding] = useState(false);
  const [experimentPrompt, setExperimentPrompt] = useState<ActionRow | null>(null);
  const [experimentWarnings, setExperimentWarnings] = useState<string[]>([]);

  const createExperiment = api.experiments.createFromAction.useMutation({
    onSuccess: async (result) => {
      // Предупреждения о слабой базе сравнения показываются сразу, а не прячутся:
      // агентство должно понимать, чего стоит будущая оценка.
      setExperimentWarnings(result.warnings);
      if (result.warnings.length === 0) {
        setExperimentPrompt(null);
      }
      await utils.experiments.list.invalidate({ clientId });
    },
  });

  const update = api.actions.update.useMutation({
    onSuccess: async () => {
      await Promise.all([
        utils.actions.list.invalidate({ clientId }),
        utils.actions.activity.invalidate({ clientId }),
      ]);
    },
  });

  /** Открыть/закрыть панель: ошибка и причина отказа прошлого действия не переезжают в следующее. */
  function select(row: ActionRow | null): void {
    update.reset();
    setDropReason("");
    setSelected(row);
  }

  function moveTo(action: ActionRow, status: Status): void {
    update.mutate(
      { id: action.id, status },
      {
        // Завершение действия — момент, когда его ещё можно честно связать
        // с последующим изменением. Позже baseline уже не восстановить.
        // Диалог открывается только после того, как сервер записал дату
        // завершения: раньше эксперименту не от чего отсчитывать.
        onSuccess: () => {
          if (status === "done" && action.status !== "done") {
            createExperiment.reset();
            setExperimentWarnings([]);
            setExperimentPrompt(action);
          }
        },
      },
    );
  }

  if (actions.isPending) {
    return <SkeletonCards count={3} />;
  }

  // Сбой загрузки — не «действий нет»: пустое состояние зовёт завести их
  // заново, и агентство продублирует то, что уже есть.
  if (actions.error && !actions.data) {
    return (
      <div
        role="alert"
        data-testid="form-error"
        className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-8"
      >
        <h2 className="text-base font-medium">Actions could not be loaded</h2>
        <p className="max-w-prose text-sm text-muted-foreground">{actions.error.message}</p>
        <button
          type="button"
          onClick={() => actions.refetch()}
          className={buttonClass("outline", "lg")}
        >
          Try again
        </button>
      </div>
    );
  }

  const rows = (actions.data ?? []) as ActionRow[];
  const dropped = rows.filter((row) => row.status === "dropped");

  const addButton = (
    <button
      type="button"
      data-testid="add-action"
      onClick={() => setAdding(true)}
      className={buttonClass("outline", "md")}
    >
      Add action
    </button>
  );

  if (rows.length === 0) {
    return (
      <>
        <EmptyState
          title="No actions yet"
        icon={ListChecks}
          description="Actions come from the Diagnose screen, where each recommendation carries the reason it exists. You can also add one by hand."
          action={addButton}
        />
        {adding && (
          <NewActionDialog
            clientId={clientId}
            onClose={() => setAdding(false)}
            onCreated={async () => {
              setAdding(false);
              await utils.actions.list.invalidate({ clientId });
            }}
          />
        )}
      </>
    );
  }

  return (
    <>
      <div className="mb-3 flex items-start justify-between gap-3">
        {/* Отказ сервера виден там, где нажали: карточка просто осталась бы
            в своей колонке, и было бы непонятно почему. */}
        {update.error && !selected ? (
          <p role="alert" data-testid="update-error" className="text-sm text-destructive">
            {update.error.message}
          </p>
        ) : (
          <span />
        )}
        {addButton}
      </div>

      {adding && (
        <NewActionDialog
          clientId={clientId}
          onClose={() => setAdding(false)}
          onCreated={async () => {
            setAdding(false);
            await utils.actions.list.invalidate({ clientId });
          }}
        />
      )}

      <div data-testid="actions-board" className="grid gap-4 md:grid-cols-3">
        {COLUMNS.map((column) => {
          const columnRows = rows
            .filter((row) => row.status === column.status)
            .sort((a, b) => {
              const byPriority = priority(b) - priority(a);
              return byPriority !== 0
                ? byPriority
                : new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime();
            });

          return (
            <section
              key={column.status}
              data-testid={`column-${column.status}`}
              className="flex flex-col gap-2 rounded-lg border bg-secondary/30 p-3"
              onDragOver={(event) => event.preventDefault()}
              onDrop={(event) => {
                event.preventDefault();
                const id = event.dataTransfer.getData("text/plain");
                const dragged = rows.find((row) => row.id === id);
                if (dragged && dragged.status !== column.status) {
                  moveTo(dragged, column.status);
                }
              }}
            >
              <h2 className="flex items-baseline justify-between text-sm font-medium">
                {column.label}
                <span className="metric text-muted-foreground">{columnRows.length}</span>
              </h2>

              {columnRows.map((row, index) => (
                <article
                  key={row.id}
                  draggable
                  onDragStart={(event) => event.dataTransfer.setData("text/plain", row.id)}
                  className="flex cursor-grab flex-col gap-2 rounded-md border bg-background p-3"
                >
                  <div className="flex items-baseline gap-2">
                    {/* Номер в очереди: колонка отсортирована по отдаче против
                        трудозатрат, и порядок должен быть виден, а не угадываться. */}
                    <span className="metric text-xs font-semibold text-muted-foreground/60">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <button
                      type="button"
                      onClick={() => select(row)}
                      className="text-left text-sm font-medium hover:underline"
                    >
                      {row.title}
                    </button>
                  </div>

                  {/* Причина стоит на карточке, а не только в drawer'е: список
                      задач без причин — это список задач (инвариант 7). */}
                  <p className="line-clamp-2 text-xs text-muted-foreground">{row.reason}</p>

                  <div className="flex flex-wrap items-center gap-1.5 text-xs">
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-muted-foreground">
                      {row.actionType.replaceAll("_", " ")}
                    </span>
                    <span
                      className={`rounded-full px-2 py-0.5 ${IMPACT_STYLE[row.estimatedImpact] ?? ""}`}
                    >
                      impact: {row.estimatedImpact} (est.)
                    </span>
                    <span className="rounded-full bg-secondary px-2 py-0.5 text-muted-foreground">
                      effort: {row.effort}
                    </span>
                    {row.sourceDomain && (
                      <span className="text-muted-foreground">{row.sourceDomain}</span>
                    )}
                  </div>

                  {/* Кто ведёт работу. Без владельца задача стоит молча, и
                      через месяц никто не помнит, чья она. */}
                  <span className="text-xs text-muted-foreground">
                    {ownerName(row.ownerUserId, members.data) ?? "unassigned"}
                  </span>

                  {/* Кнопки перемещения рядом с drag-and-drop: перетаскивание
                      неудобно на узких экранах и недоступно с клавиатуры. */}
                  <div className="flex gap-1">
                    {COLUMNS.filter((target) => target.status !== row.status).map((target) => (
                      <button
                        key={target.status}
                        type="button"
                        data-testid={`move-${row.id}-${target.status}`}
                        onClick={() => moveTo(row, target.status)}
                        className="rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-accent"
                      >
                        → {target.label}
                      </button>
                    ))}
                  </div>
                </article>
              ))}
            </section>
          );
        })}
      </div>

      {dropped.length > 0 && (
        // Снятые работы не исчезают: агентство должно уметь ответить, почему
        // сняли, когда та же рекомендация придёт снова.
        <details data-testid="dropped-actions" className="rounded-lg border p-3">
          <summary className="cursor-pointer text-sm text-muted-foreground">
            {dropped.length} dropped
          </summary>
          <ul className="mt-2 flex flex-col gap-1 text-sm">
            {dropped.map((row) => (
              <li key={row.id} className="flex justify-between gap-3 border-b py-1.5 last:border-0">
                <button
                  type="button"
                  onClick={() => select(row)}
                  className="text-left hover:underline"
                >
                  {row.title}
                </button>
                <span className="metric shrink-0 text-xs text-muted-foreground">
                  {formatDay(row.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {selected && (
        <aside
          data-testid="action-drawer"
          className="fixed inset-y-0 right-0 z-20 flex w-full max-w-md flex-col gap-4 overflow-y-auto border-l bg-background p-6 shadow-lg"
        >
          <div className="flex items-start justify-between gap-4">
            <h2 className="text-lg font-semibold">{selected.title}</h2>
            <button
              type="button"
              onClick={() => select(null)}
              aria-label="Close"
              className="text-muted-foreground hover:text-foreground"
            >
              ×
            </button>
          </div>

          <div className="flex flex-col gap-1">
            <span className="text-sm font-medium">Why this action exists</span>
            {/* Reason — то, что агентство перескажет клиенту, поэтому он в drawer'е
                на видном месте, а не спрятан в подписи карточки. */}
            <p data-testid="drawer-reason" className="text-sm text-muted-foreground">
              {selected.reason}
            </p>
          </div>

          <dl className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <dt className="text-muted-foreground">Type</dt>
              <dd>{selected.actionType.replaceAll("_", " ")}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Status</dt>
              <dd>{selected.status.replaceAll("_", " ")}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Estimated impact</dt>
              <dd>{selected.estimatedImpact}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Effort</dt>
              <dd>{selected.effort}</dd>
            </div>
            {selected.sourceDomain && (
              <div className="col-span-2">
                <dt className="text-muted-foreground">Source</dt>
                <dd>{selected.sourceDomain}</dd>
              </div>
            )}
            <div className="col-span-2">
              <dt className="text-muted-foreground">Created</dt>
              <dd className="metric">{formatDateTime(selected.createdAt)}</dd>
            </div>
            {selected.completedAt && (
              <div className="col-span-2">
                <dt className="text-muted-foreground">Completed</dt>
                <dd className="metric">{formatDateTime(selected.completedAt)}</dd>
              </div>
            )}
          </dl>

          <div className="flex flex-col gap-1.5 border-t pt-4">
            <label htmlFor="owner" className="text-sm font-medium">
              Owner
            </label>
            <select
              id="owner"
              data-testid="owner-select"
              value={selected.ownerUserId ?? ""}
              onChange={(event) => {
                const ownerUserId = event.target.value || null;
                const previous = selected.ownerUserId;
                setSelected({ ...selected, ownerUserId });
                update.mutate(
                  { id: selected.id, ownerUserId },
                  {
                    // Сервер не принял — селект возвращается к тому, что записано.
                    onError: () =>
                      setSelected((current) =>
                        current?.id === selected.id ? { ...current, ownerUserId: previous } : current,
                      ),
                  },
                );
              }}
              className={cn(controlClass, "h-10 px-2.5")}
            >
              <option value="">Unassigned</option>
              {(members.data ?? []).map((member) => (
                <option key={member.id} value={member.id}>
                  {member.name || member.email}
                </option>
              ))}
            </select>
          </div>

          {selected.status !== "dropped" && (
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium">Not going to do it?</span>
              {/* Причина обязательна: задача, снятая молча, вернётся той же
                  рекомендацией через месяц, и спорить придётся заново. */}
              <textarea
                data-testid="drop-reason"
                value={dropReason}
                onChange={(event) => setDropReason(event.target.value)}
                placeholder="Why this is not worth doing"
                rows={2}
                maxLength={500}
                className={cn(controlClass, "p-2.5")}
              />
              <button
                type="button"
                data-testid="drop-action"
                disabled={!dropReason.trim() || update.isPending}
                onClick={() => {
                  // Причина стирается и панель закрывается только после ответа
                  // сервера: при отказе набранный текст не должен пропасть.
                  update.mutate(
                    { id: selected.id, status: "dropped", dropReason: dropReason.trim() },
                    {
                      onSuccess: () => {
                        setDropReason("");
                        setSelected(null);
                      },
                    },
                  );
                }}
                className="h-9 self-start rounded-md border px-3 text-sm font-medium hover:bg-accent disabled:opacity-60"
              >
                {update.isPending && update.variables?.status === "dropped"
                  ? "Dropping…"
                  : "Drop the action"}
              </button>
            </div>
          )}

          {update.error && (
            <p role="alert" data-testid="update-error" className="text-sm text-destructive">
              {update.error.message}
            </p>
          )}

          <ActionOutcomePanel actionId={selected.id} />
          <ActionBriefPanel actionId={selected.id} />
        </aside>
      )}

      {experimentPrompt && (
        <div
          data-testid="experiment-dialog"
          role="dialog"
          aria-label="Create experiment"
          className="fixed inset-0 z-30 flex items-center justify-center bg-foreground/20 p-4"
        >
          <div className="flex max-w-md flex-col gap-3 rounded-lg border bg-background p-6 shadow-lg">
            <h2 className="text-base font-medium">Create an experiment from this action?</h2>
            <p className="text-sm text-muted-foreground">
              Recording the baseline now is what makes it possible to show what changed afterwards.
              Once more weeks pass, the period before the action can no longer be reconstructed.
            </p>
            <div className="flex gap-2">
              <button
                type="button"
                data-testid="create-experiment"
                disabled={createExperiment.isPending}
                onClick={() => createExperiment.mutate({ actionId: experimentPrompt.id })}
                className={buttonClass("primary", "md")}
              >
                {createExperiment.isPending ? "Creating…" : "Create experiment"}
              </button>
              <button
                type="button"
                onClick={() => {
                  setExperimentPrompt(null);
                  setExperimentWarnings([]);
                }}
                className={buttonClass("outline", "md")}
              >
                {createExperiment.isSuccess ? "Close" : "Not now"}
              </button>
            </div>

            {createExperiment.error && (
              <p role="alert" data-testid="form-error" className="text-sm text-destructive">
                {createExperiment.error.message}
              </p>
            )}

            {experimentWarnings.length > 0 && (
              <ul data-testid="experiment-warnings" className="flex flex-col gap-1 text-sm text-muted-foreground">
                {experimentWarnings.map((warning) => (
                  <li key={warning}>{warning}</li>
                ))}
              </ul>
            )}
          </div>
        </div>
      )}
    </>
  );
}

/**
 * Рабочее задание по действию.
 *
 * Загружается отдельным запросом при открытии drawer'а, а не вместе со списком:
 * бриф нужен одному действию из тридцати, и тянуть его на всю доску незачем.
 */
function ActionBriefPanel({ actionId }: { actionId: string }) {
  const brief = api.actions.brief.useQuery({ actionId });

  if (brief.isPending) {
    return <SkeletonText lines={4} />;
  }

  if (!brief.data) {
    return null;
  }

  const { objective, context, steps, acceptance, pitfalls, verify } = brief.data;

  /**
   * Бриф уезжает в чужой инструмент: работу делают люди в Notion, Asana или
   * в письме подрядчику. Отдаём простым текстом, а не разметкой — он должен
   * читаться там, куда его вставят.
   */
  const asText = [
    objective,
    "",
    ...context,
    "",
    "Steps:",
    ...steps.map((step, index) => `${index + 1}. ${step}`),
    "",
    "Accepted when:",
    ...acceptance.map((line) => `- ${line}`),
    ...(pitfalls.length > 0 ? ["", "Watch out for:", ...pitfalls.map((line) => `- ${line}`)] : []),
    "",
    "How to check it reached the answers:",
    ...verify.map((line) => `- ${line}`),
  ].join("\n");

  return (
    <section data-testid="action-brief" className="flex flex-col gap-4 border-t pt-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h3 className="text-sm font-medium">What done looks like</h3>
          <p className="text-sm text-muted-foreground">{objective}</p>
        </div>
        <button
          type="button"
          data-testid="copy-brief"
          onClick={() => void navigator.clipboard?.writeText(asText)}
          className={buttonClass("outline", "sm", "shrink-0")}
        >
          Copy brief
        </button>
      </div>

      {context.length > 0 && (
        <ul data-testid="brief-context" className="flex flex-col gap-1 text-sm text-muted-foreground">
          {context.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      )}

      <div className="flex flex-col gap-1.5">
        <h4 className="text-sm font-medium">Steps</h4>
        <ol data-testid="brief-steps" className="flex list-inside list-decimal flex-col gap-1.5 text-sm text-muted-foreground">
          {steps.map((step) => (
            <li key={step}>{step}</li>
          ))}
        </ol>
      </div>

      <div className="flex flex-col gap-1.5">
        <h4 className="text-sm font-medium">Accepted when</h4>
        <ul data-testid="brief-acceptance" className="flex flex-col gap-1.5 text-sm text-muted-foreground">
          {acceptance.map((line) => (
            <li key={line} className="flex gap-2">
              <span aria-hidden className="mt-1.5 size-1.5 shrink-0 rounded-full bg-client" />
              <span>{line}</span>
            </li>
          ))}
        </ul>
      </div>

      {pitfalls.length > 0 && (
        <div className="flex flex-col gap-1.5">
          <h4 className="text-sm font-medium">Watch out for</h4>
          <ul data-testid="brief-pitfalls" className="flex flex-col gap-1.5 text-sm text-muted-foreground">
            {pitfalls.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <h4 className="text-sm font-medium">How to check it reached the answers</h4>
        <ul data-testid="brief-verify" className="flex flex-col gap-1.5 text-sm text-muted-foreground">
          {verify.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

/**
 * Что произошло после работы.
 *
 * Показывается только у закрытых действий с источником: у остальных «после»
 * не с чем сравнивать, и пустой блок был бы обещанием, а не наблюдением.
 */
function ActionOutcomePanel({ actionId }: { actionId: string }) {
  const outcome = api.actions.outcome.useQuery({ actionId });

  if (!outcome.data) {
    return null;
  }

  const { note, firstSeenAt, answersAfter, disclaimer } = outcome.data;

  return (
    <section data-testid="action-outcome" className="flex flex-col gap-2 rounded-lg border p-4">
      <h3 className="text-sm font-medium">What changed since</h3>
      <p className="text-sm text-muted-foreground">{note}</p>

      <dl className="flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <div className="flex gap-2">
          <dt className="text-muted-foreground">Answers measured since</dt>
          <dd className="metric font-medium">{answersAfter}</dd>
        </div>
        {firstSeenAt && (
          <div className="flex gap-2">
            <dt className="text-muted-foreground">First seen</dt>
            <dd className="metric font-medium">
              {formatDay(firstSeenAt)}
            </dd>
          </div>
        )}
      </dl>

      {/* Совпадение по времени — не причинность, и это сказано рядом с числом. */}
      <p className="text-xs text-muted-foreground">{disclaimer}</p>
    </section>
  );
}

/**
 * Ручное заведение работы.
 *
 * Не всё приходит из диагностики: агентство знает про клиента то, чего нет
 * в цитатах. Причина обязательна и здесь — задача без объяснения не
 * защищается перед клиентом (инвариант 7), и форма не даёт её пропустить.
 */
function NewActionDialog({
  clientId,
  onClose,
  onCreated,
}: {
  clientId: string;
  onClose: () => void;
  onCreated: () => Promise<void>;
}) {
  const [title, setTitle] = useState("");
  const [reason, setReason] = useState("");
  const [actionType, setActionType] = useState<string>("create_page");
  const [estimatedImpact, setEstimatedImpact] = useState<string>("medium");
  const [effort, setEffort] = useState<string>("medium");

  const create = api.actions.create.useMutation({
    onSuccess: async () => {
      await onCreated();
    },
  });

  const ready = title.trim().length > 0 && reason.trim().length > 0;

  return (
    <div
      data-testid="new-action-dialog"
      role="dialog"
      aria-label="Add action"
      className="fixed inset-0 z-30 flex items-center justify-center bg-foreground/20 p-4"
    >
      <div className="flex w-full max-w-md flex-col gap-3 rounded-lg border bg-background p-6 shadow-lg">
        <h2 className="text-base font-medium">Add an action</h2>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Title</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={300}
            className={cn(controlClass, "h-10 px-3")}
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Why this action exists</span>
          <textarea
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="What in the measurements makes this worth doing"
            className={cn(controlClass, "p-2.5")}
          />
        </label>

        <div className="grid grid-cols-3 gap-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Type</span>
            <select
              aria-label="Type"
              value={actionType}
              onChange={(event) => setActionType(event.target.value)}
              className={cn(controlClass, "h-10 px-2.5")}
            >
              {ACTION_TYPES.map((type) => (
                <option key={type} value={type}>
                  {type.replaceAll("_", " ")}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Impact</span>
            <select
              aria-label="Impact"
              value={estimatedImpact}
              onChange={(event) => setEstimatedImpact(event.target.value)}
              className={cn(controlClass, "h-10 px-2.5")}
            >
              {["low", "medium", "high"].map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Effort</span>
            <select
              aria-label="Effort"
              value={effort}
              onChange={(event) => setEffort(event.target.value)}
              className={cn(controlClass, "h-10 px-2.5")}
            >
              {["low", "medium", "high"].map((level) => (
                <option key={level} value={level}>
                  {level}
                </option>
              ))}
            </select>
          </label>
        </div>

        {create.error && (
          <p data-testid="form-error" className="text-sm text-destructive">
            {create.error.message}
          </p>
        )}

        <div className="flex gap-2">
          <button
            type="button"
            data-testid="create-manual-action"
            disabled={!ready || create.isPending}
            onClick={() =>
              create.mutate({
                clientId,
                title: title.trim(),
                reason: reason.trim(),
                actionType: actionType as (typeof ACTION_TYPES)[number],
                estimatedImpact: estimatedImpact as "low" | "medium" | "high",
                effort: effort as "low" | "medium" | "high",
                affectedClusterIds: [],
              })
            }
            className={buttonClass("primary", "lg")}
          >
            Create action
          </button>
          <button
            type="button"
            onClick={onClose}
            className={buttonClass("outline", "lg")}
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
