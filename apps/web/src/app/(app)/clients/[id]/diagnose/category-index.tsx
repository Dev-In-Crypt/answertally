"use client";

import Link from "next/link";
import { CATEGORY_INDEX_MIN_WORKSPACES, CATEGORY_INDEX_WINDOW_DAYS, categoryLabel } from "@repo/core/config/categories";
import { api } from "@/trpc/react";
import { FIELD_NOTES_1 } from "@/app/research/field-notes";

/**
 * Общий индекс источников категории: где ассистенты берут ответы у всех
 * агентств, без имён. Пока агентств в категории меньше порога, честно говорит,
 * что индекса ещё нет, а не показывает выдуманное.
 */
export function CategoryIndex({ clientId }: { clientId: string }) {
  const index = api.clients.categoryIndex.useQuery({ id: clientId });
  if (!index.data) return null;
  const { category, workspaces, answers, top } = index.data;
  const label = categoryLabel(category);

  return (
    <section data-testid="category-index" className="flex flex-col gap-3 rounded-lg border p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-medium">
          Where assistants look{label ? ` in ${label}` : ""}, across agencies
        </h2>
        <p className="text-sm text-muted-foreground">
          Sites cited in answers for every client in this category over the last{" "}
          {CATEGORY_INDEX_WINDOW_DAYS} days, from all agencies, with no client or agency named. Your
          own client&rsquo;s sources are above; this is the wider field.
        </p>
      </div>

      {!category ? (
        <p className="text-sm">
          Set a category for this client to see it.{" "}
          <Link className="text-primary underline" href={`/clients/${clientId}/settings`}>
            Client settings →
          </Link>
        </p>
      ) : top.length === 0 ? (
        <div className="flex flex-col gap-3">
          <p data-testid="category-index-pending" className="text-sm">
            The shared index builds once at least {CATEGORY_INDEX_MIN_WORKSPACES} agencies measure
            clients in this category, so that no single agency&rsquo;s work can be read from it.
            {workspaces > 0 ? ` So far: ${workspaces}.` : ""}
          </p>
          <ResearchFallback category={category} />
        </div>
      ) : (
        <ol data-testid="category-index-list" className="flex flex-col gap-2 text-sm">
          {top.map((row) => {
            const share = answers > 0 ? (row.answers / answers) * 100 : 0;
            return (
              <li key={row.domain} className="grid grid-cols-[minmax(0,14rem)_1fr_auto] items-center gap-3">
                <span className="truncate">{row.domain}</span>
                <span className="h-2.5 overflow-hidden rounded-full bg-muted">
                  <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.min(100, share)}%` }} />
                </span>
                <span className="metric whitespace-nowrap text-right">
                  {Math.round(share)}% · {row.answers} of {answers} answers
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

/**
 * Пока общего индекса нет — наше собственное исследование той же категории,
 * если оно есть. Подписано как исследование, а не как данные агентств.
 */
function ResearchFallback({ category }: { category: string }) {
  const brand = FIELD_NOTES_1.find((b) => b.categoryId === category);
  if (!brand) return null;
  return (
    <div data-testid="category-index-research" className="flex flex-col gap-2">
      <p className="text-sm text-muted-foreground">
        Meanwhile, from our own research in this category ({brand.sources.answers} answers about one
        brand, October 2026):
      </p>
      <ol className="flex flex-col gap-1 text-sm">
        {brand.sources.top
          .filter((source) => !source.own)
          .map((source) => (
            <li key={source.domain} className="flex justify-between gap-3">
              <span className="truncate">{source.domain}</span>
              <span className="metric whitespace-nowrap text-muted-foreground">
                {source.answers} of {brand.sources.answers} answers
              </span>
            </li>
          ))}
      </ol>
    </div>
  );
}
