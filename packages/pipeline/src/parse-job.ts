import { domainOf, parseResponse } from "@repo/core";
import type { EntityDictionary, LlmExtractor } from "@repo/core";
import {
  getClientForResponse,
  getResponseById,
  listResponsesByRun,
  replaceCitations,
  replaceMentions,
} from "@repo/db";
import type { Database } from "@repo/db";

export interface ParseOutcome {
  responseId: string;
  mentions: number;
  citations: number;
}

/**
 * Разбирает один ответ и складывает результат в mentions/citations.
 * Идемпотентен: повторный запуск заменяет прежний разбор, а не дополняет его —
 * иначе улучшение парсера удваивало бы данные при переобработке.
 */
export async function parseStoredResponse(
  db: Database,
  responseId: string,
  llm?: LlmExtractor,
): Promise<ParseOutcome> {
  const response = await getResponseById(db, responseId);
  if (!response) {
    throw new Error(`Response ${responseId} not found`);
  }

  const client = await getClientForResponse(db, responseId);
  if (!client) {
    throw new Error(`Client for response ${responseId} not found`);
  }

  const dictionary: EntityDictionary = {
    // Имя клиента — запасной вариант, если алиасы не заполнены.
    brandNames: client.brandNames.length > 0 ? client.brandNames : [client.name],
    competitorNames: client.competitorNames,
  };

  // Citations платформы не хранятся отдельно от ответа, поэтому берём их из
  // сохранённого разбора адаптера: в БД лежит только текст, ссылки приходят
  // вместе с ним на этапе прогона. Здесь они уже разложены в таблицу citations,
  // поэтому переразбор опирается на текст, а ссылки переносятся как есть.
  const parsed = await parseResponse(response.rawText, [], dictionary, llm ? { llm } : {});

  await replaceMentions(
    db,
    responseId,
    parsed.mentions.map((mention) => ({
      responseId,
      entityType: mention.isClient ? ("client" as const) : ("competitor" as const),
      entityName: mention.name,
      position: mention.position,
      sentiment: mention.sentiment,
      isClient: mention.isClient,
      isCompetitor: mention.isCompetitor,
    })),
  );

  return { responseId, mentions: parsed.mentions.length, citations: 0 };
}

/** Сохраняет ссылки ответа. Вызывается на этапе прогона, где они ещё доступны. */
export async function storeCitations(
  db: Database,
  responseId: string,
  urls: { url: string; title?: string }[],
): Promise<number> {
  // Только http(s): ссылки приходят от ассистента, а значит и от любого,
  // кто подбросил ему страницу. `javascript:` в ссылке на экране — это код.
  const rows = urls
    .filter((citation) => /^https?:\/\//i.test(citation.url))
    .map((citation, index) => ({
      responseId,
      url: citation.url,
      domain: domainOf(citation.url),
      title: citation.title ?? null,
      position: index + 1,
    }));

  await replaceCitations(db, responseId, rows);
  return rows.length;
}

/** Разбирает все ответы прогона. */
export async function parseRun(
  db: Database,
  runId: string,
  llm?: LlmExtractor,
): Promise<ParseOutcome[]> {
  const responses = await listResponsesByRun(db, runId);
  const outcomes: ParseOutcome[] = [];

  for (const response of responses) {
    outcomes.push(await parseStoredResponse(db, response.id, llm));
  }

  return outcomes;
}
