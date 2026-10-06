"use client";

import { useState } from "react";
import { DEFAULT_GENERATED_PROMPT_COUNT, GENERATED_PROMPT_RANGE } from "@repo/core";
import type { GeneratedPrompt } from "@repo/core";
import { PROMPT_TEXT_MAX } from "@repo/core/config/measurement";
import { api } from "@/trpc/react";
import { buttonClass } from "@/components/ui/button";
import { inputClass } from "@/components/ui/field";

/**
 * Черновик набора промптов для аудита.
 *
 * Список редактируется до сохранения и ничего не пишет в базу сам: предложение
 * генератора — это догадка о том, как спрашивают покупатели, и человек,
 * знающий клиента, правит её быстрее, чем потом читает измерения не по делу.
 */


export function GeneratePrompts({
  clientId,
  industry,
  onSaved,
}: {
  clientId: string;
  industry: string | null;
  onSaved: () => Promise<void>;
}) {
  const [industryInput, setIndustryInput] = useState(industry ?? "");
  // Карточка клиента грузится после первого рендера: отрасль с первого шага
  // приходит позже и подставляется, если человек ещё ничего не вписал сам.
  const [seenIndustry, setSeenIndustry] = useState(industry);
  if (industry !== seenIndustry) {
    setSeenIndustry(industry);
    if (industry && !industryInput) setIndustryInput(industry);
  }
  // Строкой: очищенное поле иначе становилось нулём и уходило на сервер.
  const [countInput, setCountInput] = useState(String(DEFAULT_GENERATED_PROMPT_COUNT));
  const [draft, setDraft] = useState<GeneratedPrompt[] | null>(null);
  const [summary, setSummary] = useState<string | null>(null);

  const count = Number(countInput);
  const countValid =
    Number.isInteger(count) &&
    count >= GENERATED_PROMPT_RANGE.min &&
    count <= GENERATED_PROMPT_RANGE.max;

  const generate = api.prompts.generate.useMutation({
    onSuccess: (result) => {
      setSummary(null);
      setDraft(result.prompts);
    },
  });

  const save = api.prompts.saveGenerated.useMutation({
    onSuccess: async (result) => {
      setDraft(null);
      setSummary(
        `Saved ${result.createdPrompts} prompts into ${result.createdClusters} new clusters.` +
          (result.alreadyTracked > 0
            ? ` ${result.alreadyTracked} were already tracked for this client and skipped.`
            : ""),
      );
      await onSaved();
    },
  });
  // Отказ сервера (потолок вопросов, генератор) — словами под кнопками.
  const error = generate.error ?? save.error;

  function editPrompt(index: number, text: string) {
    setDraft((current) =>
      current
        ? current.map((prompt, position) => (position === index ? { ...prompt, text } : prompt))
        : current,
    );
  }

  function removePrompt(index: number) {
    setDraft((current) => current?.filter((_, position) => position !== index) ?? current);
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-dashed p-4">
      <h2 className="text-base font-medium">Generate buyer prompts</h2>
      <p className="max-w-prose text-sm text-muted-foreground">
        A starting set of questions buyers ask in this category. Edit or drop anything that does not
        fit before saving. Nothing is measured until you save.
      </p>

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Industry</span>
          <input
            value={industryInput}
            onChange={(event) => setIndustryInput(event.target.value)}
            placeholder="CRM software"
            className={`${inputClass} min-w-56`}
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">How many</span>
          <input
            type="number"
            min={GENERATED_PROMPT_RANGE.min}
            max={GENERATED_PROMPT_RANGE.max}
            value={countInput}
            onChange={(event) => setCountInput(event.target.value)}
            aria-invalid={!countValid}
            className={`${inputClass} w-24`}
          />
        </label>
        <button
          type="button"
          data-testid="generate-prompts"
          disabled={generate.isPending || !countValid}
          onClick={() =>
            generate.mutate({
              clientId,
              industry: industryInput.trim() || undefined,
              count,
            })
          }
          className={buttonClass("primary", "lg")}
        >
          {generate.isPending ? "Generating…" : "Generate buyer prompts"}
        </button>
      </div>

      {!countValid && (
        <p className="text-sm text-destructive">
          How many: a whole number from {GENERATED_PROMPT_RANGE.min} to{" "}
          {GENERATED_PROMPT_RANGE.max}.
        </p>
      )}

      {summary && (
        <p data-testid="generate-summary" className="text-sm text-muted-foreground">
          {summary}
        </p>
      )}

      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error.message}
        </p>
      )}

      {draft && (
        <div className="flex flex-col gap-3">
          <p className="text-sm text-muted-foreground">
            <span data-testid="draft-count" className="metric">
              {draft.length}
            </span>{" "}
            prompts proposed. Control prompts are kept untouched by actions, so experiments have
            something to compare against.
          </p>

          <ul data-testid="prompt-draft" className="flex flex-col gap-1.5">
            {draft.map((prompt, index) => (
              <li key={`${prompt.cluster}-${index}`} className="flex items-center gap-2">
                <input
                  value={prompt.text}
                  maxLength={PROMPT_TEXT_MAX}
                  aria-label={`Prompt ${index + 1}`}
                  onChange={(event) => editPrompt(index, event.target.value)}
                  className={`${inputClass} min-w-0 flex-1`}
                />
                <span className="w-40 shrink-0 truncate text-xs text-muted-foreground">
                  {prompt.cluster}
                </span>
                {prompt.isControl && (
                  <span className="rounded-full border px-2 py-0.5 text-xs text-muted-foreground">
                    control
                  </span>
                )}
                <button
                  type="button"
                  aria-label={`Remove prompt ${index + 1}`}
                  onClick={() => removePrompt(index)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>

          <div className="flex items-center gap-3">
            <button
              type="button"
              data-testid="save-generated"
              disabled={save.isPending || draft.every((prompt) => prompt.text.trim() === "")}
              onClick={() =>
                save.mutate({
                  clientId,
                  prompts: draft.filter((prompt) => prompt.text.trim().length > 0),
                })
              }
              className={buttonClass("primary", "lg")}
            >
              {save.isPending
                ? "Saving…"
                : `Save ${draft.filter((prompt) => prompt.text.trim().length > 0).length} prompts`}
            </button>
            <button
              type="button"
              onClick={() => setDraft(null)}
              className={buttonClass("outline", "lg")}
            >
              Discard
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
