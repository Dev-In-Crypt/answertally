"use client";

import { useState } from "react";
import Link from "next/link";
import { decodeCsvBytes } from "@repo/core";
import { CLUSTER_NAME_MAX, PROMPT_TEXT_MAX } from "@repo/core/config/measurement";
import { api } from "@/trpc/react";
import { EmptyState } from "@/components/page-header";
import { SchedulePanel } from "./schedule-panel";
import { GeneratePrompts } from "./generate-prompts";
import { buttonClass } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";
import { FileInput } from "@/components/ui/file-input";
import { SkeletonCards } from "@/components/ui/skeleton";
import { MessageSquare } from "lucide-react";

const INTENTS = ["comparison", "learning", "purchase", "other"] as const;

/**
 * Отказ сервера словами — рядом с кнопкой, которая его вызвала. Без этого
 * потолок вопросов или битый файл выглядели как кнопка, которая не работает.
 */
function ErrorLine({ error }: { error: { message: string } | null }) {
  if (!error) return null;
  return (
    <p role="alert" className="text-sm text-destructive">
      {error.message}
    </p>
  );
}

export function MeasureView({ clientId }: { clientId: string }) {
  const utils = api.useUtils();
  const client = api.clients.get.useQuery({ id: clientId });
  const clusters = api.prompts.clusters.useQuery({ clientId });
  const prompts = api.prompts.list.useQuery({ clientId });

  const [clusterName, setClusterName] = useState("");
  const [clusterIntent, setClusterIntent] = useState<(typeof INTENTS)[number]>("comparison");

  const refresh = async () => {
    await Promise.all([
      utils.prompts.clusters.invalidate({ clientId }),
      utils.prompts.list.invalidate({ clientId }),
    ]);
  };

  const createCluster = api.prompts.createCluster.useMutation({
    onSuccess: async () => {
      setClusterName("");
      await refresh();
    },
  });

  const deleteCluster = api.prompts.deleteCluster.useMutation({ onSuccess: refresh });

  if (clusters.isPending || prompts.isPending) {
    return <SkeletonCards count={3} />;
  }

  const promptsByCluster = new Map<string, typeof prompts.data>();
  for (const prompt of prompts.data ?? []) {
    const list = promptsByCluster.get(prompt.clusterId) ?? [];
    list.push(prompt);
    promptsByCluster.set(prompt.clusterId, list);
  }

  return (
    <div className="flex flex-col gap-8">
      <SchedulePanel clientId={clientId} />
      <GeneratePrompts
        clientId={clientId}
        industry={client.data?.industry ?? null}
        onSaved={refresh}
      />
      <CsvImport clientId={clientId} onImported={refresh} />

      <section className="flex flex-col gap-3">
        <h2 className="text-base font-medium">Add a cluster</h2>
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Cluster name</span>
            <input
              value={clusterName}
              onChange={(e) => setClusterName(e.target.value)}
              placeholder="CRM comparison"
              maxLength={CLUSTER_NAME_MAX}
              className={inputClass}
            />
          </label>
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-medium">Intent</span>
            <select
              value={clusterIntent}
              onChange={(e) => setClusterIntent(e.target.value as (typeof INTENTS)[number])}
              className={inputClass}
            >
              {INTENTS.map((intent) => (
                <option key={intent} value={intent}>
                  {intent}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={!clusterName.trim() || createCluster.isPending}
            onClick={() =>
              createCluster.mutate({ clientId, name: clusterName, intent: clusterIntent })
            }
            className={buttonClass("primary", "lg")}
          >
            Add cluster
          </button>
        </div>
        <ErrorLine error={createCluster.error ?? deleteCluster.error} />
        <p className="max-w-prose text-sm text-muted-foreground">
          Intent decides which answer format models tend to cite, so it is worth setting honestly.
        </p>
      </section>

      {(clusters.data ?? []).length === 0 ? (
        <EmptyState
          title="No prompt clusters yet"
        icon={MessageSquare}
          description="Add a cluster or import a CSV. Clusters group the buyer questions you track, so movement can be read per topic instead of one blended number."
        />
      ) : (
        <ul data-testid="clusters-list" className="flex flex-col gap-4">
          {(clusters.data ?? []).map((cluster) => (
            <li key={cluster.id} className="rounded-lg border p-4">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <span className="font-medium">{cluster.name}</span>
                  <span className="rounded-full bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
                    {cluster.intent}
                  </span>
                  <span className="metric text-sm text-muted-foreground">
                    {promptsByCluster.get(cluster.id)?.length ?? 0} prompts
                  </span>
                </div>
                <button
                  type="button"
                  disabled={deleteCluster.isPending}
                  onClick={() => {
                    // Удаление уносит и измеренные ответы — история графиков
                    // меняется, поэтому одного клика мало.
                    const count = promptsByCluster.get(cluster.id)?.length ?? 0;
                    if (
                      window.confirm(
                        `Delete the cluster "${cluster.name}" and its ${count} prompts? Every measured answer for these prompts is deleted too, and past visibility changes. This cannot be undone.`,
                      )
                    ) {
                      deleteCluster.mutate({ id: cluster.id });
                    }
                  }}
                  className="text-sm text-muted-foreground hover:text-destructive"
                >
                  Remove
                </button>
              </div>

              <PromptList
                clientId={clientId}
                clusterId={cluster.id}
                prompts={promptsByCluster.get(cluster.id) ?? []}
                onChanged={refresh}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type PromptRow = {
  id: string;
  text: string;
  isControl: boolean;
};

function PromptList({
  clientId,
  clusterId,
  prompts,
  onChanged,
}: {
  clientId: string;
  clusterId: string;
  prompts: PromptRow[];
  onChanged: () => Promise<void>;
}) {
  const [text, setText] = useState("");
  const [isControl, setIsControl] = useState(false);

  const create = api.prompts.create.useMutation({
    onSuccess: async () => {
      setText("");
      setIsControl(false);
      await onChanged();
    },
  });
  const remove = api.prompts.delete.useMutation({ onSuccess: onChanged });

  return (
    <div className="flex flex-col gap-2">
      <ul className="flex flex-col gap-1">
        {prompts.map((prompt) => (
          <li
            key={prompt.id}
            className="flex items-center justify-between gap-3 rounded-md bg-secondary/50 px-3 py-1.5 text-sm"
          >
            <span className="flex items-center gap-2">
              {/* Клик ведёт к сырым ответам: возможность проверить цифру — часть продукта. */}
              <Link
                href={`/clients/${clientId}/prompts/${prompt.id}`}
                className="underline-offset-4 hover:underline"
              >
                {prompt.text}
              </Link>
              {prompt.isControl && (
                <span
                  data-testid="control-badge"
                  title="Control prompt — untouched by actions, used as a comparison baseline"
                  className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground"
                >
                  control
                </span>
              )}
            </span>
            <button
              type="button"
              disabled={remove.isPending}
              onClick={() => {
                if (
                  window.confirm(
                    `Delete "${prompt.text}"? Every measured answer for this prompt is deleted too, and past visibility changes. This cannot be undone.`,
                  )
                ) {
                  remove.mutate({ id: prompt.id });
                }
              }}
              className="text-muted-foreground hover:text-destructive"
              aria-label={`Delete prompt ${prompt.text}`}
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-2">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="best CRM for startups"
          maxLength={PROMPT_TEXT_MAX}
          aria-label={`New prompt for cluster`}
          className={`${inputClass} min-w-64 flex-1`}
        />
        <label className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <input
            type="checkbox"
            checked={isControl}
            onChange={(e) => setIsControl(e.target.checked)}
          />
          control
        </label>
        <button
          type="button"
          disabled={!text.trim() || create.isPending}
          onClick={() => create.mutate({ clusterId, text, isControl })}
          className={buttonClass("outline", "lg")}
        >
          Add prompt
        </button>
      </div>
      <ErrorLine error={create.error ?? remove.error} />
    </div>
  );
}

function CsvImport({ clientId, onImported }: { clientId: string; onImported: () => Promise<void> }) {
  const [summary, setSummary] = useState<string | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const importCsv = api.prompts.importCsv.useMutation({
    onSuccess: async (result) => {
      setSummary(
        `Imported ${result.createdPrompts} prompts into ${result.createdClusters} new clusters.` +
          (result.alreadyTracked > 0
            ? ` ${result.alreadyTracked} already tracked for this client, skipped.`
            : ""),
      );
      setErrors(result.errors);
      await onImported();
    },
    onError: (error) => setErrors([error.message]),
  });

  async function handleFile(file: File | null) {
    if (!file) return;
    setSummary(null);
    setErrors([]);
    // Байты, а не file.text(): ANSI-выгрузка Excel иначе портит буквы.
    const csv = decodeCsvBytes(new Uint8Array(await file.arrayBuffer()));
    // Те же границы, что у сервера, но словами, а не отказом валидации.
    if (csv.trim() === "") {
      setErrors(["The file is empty."]);
    } else if (csv.length > 500_000) {
      setErrors(["The file is over 500 KB. Split it and import the parts one by one."]);
    } else {
      importCsv.mutate({ clientId, csv });
    }
  }

  return (
    <section className="flex flex-col gap-2 rounded-lg border border-dashed p-4">
      <h2 className="text-base font-medium">Import prompts from CSV</h2>
      <p className="max-w-prose text-sm text-muted-foreground">
        Columns: <code>cluster, intent, prompt, is_control</code>. Rows with problems are reported
        rather than silently dropped.
      </p>
      {/*
        Подпись остаётся дословно «Prompts CSV»: по ней экран находят
        e2e-сценарии, а у самого поля она и была — менялся только вид.
      */}
      <FileInput
        label="Prompts CSV"
        accept=".csv,text/csv"
        disabled={importCsv.isPending}
        buttonText="Choose CSV"
        onSelect={(file) => void handleFile(file)}
      />
      {summary && (
        <p data-testid="import-summary" className="text-sm text-muted-foreground">
          {summary}
        </p>
      )}
      {errors.length > 0 && (
        <ul data-testid="import-errors" className="text-sm text-destructive">
          {errors.map((error) => (
            <li key={error}>{error}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
