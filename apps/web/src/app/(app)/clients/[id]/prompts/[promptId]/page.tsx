"use client";

import { use, useState } from "react";
import Link from "next/link";
import { keepPreviousData } from "@tanstack/react-query";
import { ASSISTANTS, highlightMentions, startOfIsoWeek } from "@repo/core";
import { api } from "@/trpc/react";
import { EmptyState, PageHeader } from "@/components/page-header";
import { buttonClass } from "@/components/ui/button";
import { SkeletonCards } from "@/components/ui/skeleton";
import { MessageSquare } from "lucide-react";

/** «2nd», «3rd» — порядковый суффикс для места среди названных брендов. */
function ordinal(rank: number | null): string {
  if (rank === null) return "";
  if (rank % 100 >= 11 && rank % 100 <= 13) return "th";
  return { 1: "st", 2: "nd", 3: "rd" }[rank % 10] ?? "th";
}

// Подписи берутся из каталога: новый ассистент не требует правки в каждом экране.
const PLATFORM_LABELS: Record<string, string> = Object.fromEntries(
  ASSISTANTS.map((assistant) => [assistant.id, assistant.label]),
);

export default function PromptResponsesPage({
  params,
}: {
  params: Promise<{ id: string; promptId: string }>;
}) {
  const { id, promptId } = use(params);
  const [limit, setLimit] = useState(30);
  const data = api.runs.responses.useQuery(
    { promptId, limit },
    { placeholderData: keepPreviousData },
  );

  if (data.isPending) {
    return <SkeletonCards count={3} />;
  }

  // «Не найден» — только когда сервер так и ответил; сбой сети — не удаление.
  // Упавший фоновый перезапрос не прячет уже загруженные ответы.
  if (data.error && !data.data && data.error.data?.code !== "NOT_FOUND") {
    return (
      <div role="alert" className="flex flex-col items-start gap-3 rounded-lg border border-dashed p-8">
        <h2 className="text-base font-medium">Answers could not be loaded</h2>
        <p className="max-w-prose text-sm text-muted-foreground">{data.error.message}</p>
        <button type="button" onClick={() => data.refetch()} className={buttonClass("outline", "lg")}>
          Try again
        </button>
      </div>
    );
  }

  if (!data.data) {
    return <PageHeader title="Prompt not found" description="It may have been removed." />;
  }

  const { prompt, dictionary, responses, hasMore } = data.data;

  /**
   * Ответ считается «назвал клиента», если подсветка нашла в нём клиента —
   * тем же способом, каким считается доля на дашборде. Второй способ счёта
   * означал бы, что экран и цифра расходятся.
   */
  const mentionsClient = (text: string) =>
    highlightMentions(text, dictionary).some((segment) => segment.kind === "client");

  /**
   * Счёт — по последней неделе, как на дашборде (недельные окна, контракт C3):
   * смесь нескольких недель не совпала бы ни с одной цифрой там.
   */
  const latestWeek = responses[0] ? startOfIsoWeek(new Date(responses[0].createdAt)) : null;
  const weekResponses = latestWeek
    ? responses.filter(
        (response) =>
          startOfIsoWeek(new Date(response.createdAt)).getTime() === latestWeek.getTime(),
      )
    : [];
  const namedIn = weekResponses.filter((response) => mentionsClient(response.rawText));
  // При ежедневном расписании неделя длиннее страницы: тогда счёт — по показанным, и это сказано.
  const weekCut = hasMore && weekResponses.length === responses.length;

  /**
   * Место клиента среди названных брендов этого ответа. Одна доля упоминаний
   * не различает ответ, который начинается с клиента, и ответ, где он стоит
   * четвёртым после трёх конкурентов, — а покупатель различает.
   */
  const rankOf = (text: string): number | null => {
    const order: string[] = [];
    for (const segment of highlightMentions(text, dictionary)) {
      if (segment.kind === "plain") continue;
      const name = segment.entity ?? segment.text;
      if (!order.includes(name)) {
        order.push(name);
      }
      if (segment.kind === "client") {
        return order.length;
      }
    }
    return null;
  };

  return (
    <>
      <PageHeader
        title={prompt.text}
        description="Every answer behind the number, exactly as the platform returned it."
        action={
          <Link
            href={`/clients/${id}/measure`}
            className={buttonClass("outline", "lg")}
          >
            Back to prompts
          </Link>
        }
      />

      <div className="mb-4 flex flex-wrap gap-4 text-sm text-muted-foreground">
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-sm bg-client/20 ring-1 ring-client" />
          client
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block size-3 rounded-sm bg-competitor/20 ring-1 ring-competitor" />
          competitors
        </span>
        {/* Сколько ответов и в скольких из них клиент — это и есть та доля,
            которая стоит на дашборде; здесь её можно пересчитать руками. */}
        {latestWeek && (
          <span data-testid="named-in" className="metric">
            Week of {latestWeek.toISOString().slice(0, 10)}:{weekCut ? " latest" : ""}{" "}
            {weekResponses.length} {weekResponses.length === 1 ? "answer" : "answers"} · named in{" "}
            {namedIn.length}
          </span>
        )}
        {responses.length > 0 && (
          <span>
            Showing the latest {responses.length} {responses.length === 1 ? "answer" : "answers"}
            {hasMore ? "; older ones are not shown." : "."}
          </span>
        )}
        {prompt.isControl && <span>This is a control prompt.</span>}
      </div>

      {responses.length === 0 ? (
        <EmptyState
          title="No answers yet"
        icon={MessageSquare}
          description="Run a check from the Measure screen. Answers appear here in full, so you can see exactly what the number is built from."
        />
      ) : (
        <ul data-testid="responses-list" className="flex flex-col gap-4">
          {responses.map((response) => (
            <li key={response.id} className="rounded-lg border p-4">
              <div className="mb-3 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <span className="font-medium text-foreground">
                  {PLATFORM_LABELS[response.platform] ?? response.platform}
                </span>
                <span className="metric">sample {response.sampleIndex + 1}</span>
                <span className="metric">{response.modelVersion}</span>
                <span className="metric">${Number(response.costUsd).toFixed(4)}</span>
                <span className="metric">{new Date(response.createdAt).toLocaleString()}</span>
                {mentionsClient(response.rawText) ? (
                  <span
                    data-testid="named-rank"
                    className="rounded-full bg-client/15 px-2 py-1 text-[11px] font-medium"
                  >
                    {rankOf(response.rawText) === 1
                      ? "named first"
                      : `named ${rankOf(response.rawText)}${ordinal(rankOf(response.rawText))}`}
                  </span>
                ) : (
                  <span
                    data-testid="not-named"
                    className="rounded-full bg-competitor/12 px-2 py-1 text-[11px] font-medium text-competitor-ink"
                  >
                    not named
                  </span>
                )}
              </div>

              <p
                data-testid="response-text"
                className="whitespace-pre-wrap text-sm leading-relaxed"
              >
                {highlightMentions(response.rawText, dictionary).map((segment, index) =>
                  segment.kind === "plain" ? (
                    <span key={index}>{segment.text}</span>
                  ) : (
                    <mark
                      key={index}
                      data-testid={
                        segment.kind === "client" ? "mention-client" : "mention-competitor"
                      }
                      title={segment.entity}
                      className={
                        segment.kind === "client"
                          ? "rounded bg-client/20 px-0.5 text-foreground"
                          : "rounded bg-competitor/20 px-0.5 text-foreground"
                      }
                    >
                      {segment.text}
                    </mark>
                  ),
                )}
              </p>

              {response.citations.length > 0 && (
                <div className="mt-3 border-t pt-3">
                  <p className="mb-1 text-sm font-medium">Cited sources</p>
                  <ul data-testid="response-citations" className="flex flex-col gap-1 text-sm">
                    {response.citations.map((citation) => (
                      <li key={citation.id}>
                        <a
                          href={citation.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-primary underline-offset-4 hover:underline"
                        >
                          {citation.title ?? citation.domain}
                        </a>{" "}
                        <span className="text-muted-foreground">{citation.domain}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {hasMore && limit < 100 && (
        <button
          type="button"
          onClick={() => setLimit(100)}
          disabled={data.isFetching}
          className={buttonClass("outline", "lg", "mt-4")}
        >
          {data.isFetching ? "Loading…" : "Show older answers"}
        </button>
      )}
    </>
  );
}
