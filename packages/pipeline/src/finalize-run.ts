import { countResponsesByRun, finishRunWithNote, getAgencyIdForRun, logActivity } from "@repo/db";
import type { Database } from "@repo/db";
import { platformLabel } from "@repo/core";
import { parseRun } from "./parse-job";
import { classifyRunSources } from "./classify-sources";
import { aggregateClient } from "./aggregate-job";
import { detectExperimentEvents } from "./experiment-events";
import { refreshOpportunities } from "./refresh-opportunities";

/**
 * Хвост прогона: когда все ответы доехали.
 *
 * Отличается от `completeRun` тем, что сам ничего не спрашивает у платформ:
 * ответы уже получены задачами очередей. Шаги те же и в том же порядке —
 * пропущенная классификация источников не ломает ни один экран заметно,
 * диагностика просто показывает домены без вида площадки, и заметить это
 * можно спустя недели.
 */
export interface FinalizeRunOutcome {
  status: "done" | "failed";
  responses: number;
  expected: number;
  parsedResponses: number;
  classifiedDomains: number;
  snapshots: number;
  opportunities: number;
}

/** Причина для прогона, которому нечего спрашивать. */
export const NO_ACTIVE_PROMPTS_NOTE =
  "This client has no active prompts, so there was nothing to ask. Add or reactivate prompts on the measure screen.";

/**
 * Итог прогона по числу дошедших ответов — чистая функция.
 *
 * Раньше один потерянный ответ из ста сорока делал весь прогон failed:
 * аудит показывал ошибку и прятал уже посчитанные цифры, а бесплатному
 * аккаунту повторить было не на что. Теперь прогон done, если дошло
 * большинство, — с пометкой, сколько не дошло; доля и так считается по
 * агрегатам с порогом выборки (C3), и ячейка с недобором видна как
 * недобор. failed — только когда мерить почти не из чего.
 *
 * `unavailable` — ассистенты, которых не спрашивали вовсе (нет ключа на
 * сервере): об этом говорится всегда, даже у полного прогона.
 */
export function runOutcome(
  written: number,
  expected: number,
  unavailable: readonly string[] = [],
): { status: "done" | "failed"; note: string | null } {
  const notes: string[] = [];
  if (unavailable.length > 0) {
    notes.push(
      `${unavailable.map(platformLabel).join(", ")} ${unavailable.length === 1 ? "was" : "were"} not asked: not available right now.`,
    );
  }

  if (written === 0) {
    notes.unshift("No answers came back from the assistants, so nothing was measured and no checks were used.");
    return { status: "failed", note: notes.join(" ") };
  }
  if (written * 2 < expected) {
    notes.unshift(
      `Only ${written} of ${expected} answers came back — too few to measure from. The assistants were not responding reliably.`,
    );
    return { status: "failed", note: notes.join(" ") };
  }
  if (written < expected) {
    notes.unshift(
      `${written} of ${expected} answers came back; visibility is worked out from those.`,
    );
  }
  return { status: "done", note: notes.length > 0 ? notes.join(" ") : null };
}

export async function finalizeRun(
  db: Database,
  input: {
    runId: string;
    clientId: string;
    expected: number;
    /** Ассистенты, которых не спрашивали: адаптер не подключён. */
    unavailable?: readonly string[];
    /** Куда сообщить, если пересчёт возможностей упал: прогон при этом цел. */
    onError?: (error: unknown) => void;
  },
): Promise<FinalizeRunOutcome> {
  const written = await countResponsesByRun(db, input.runId);
  const { status, note } = runOutcome(written, input.expected, input.unavailable);

  // Статус ставится последним. Раньше «done» писался первым, и падение
  // разбора или свёртки оставляло прогон готовым без цифр: аудит вёл на
  // пустые возможности, а повторить сборку было уже нечему. Шаги
  // идемпотентны, задача сборки повторяется — до успеха прогон «идёт».
  const parsed = await parseRun(db, input.runId);
  const classified = await classifyRunSources(db, input.runId);
  const snapshots = await aggregateClient(db, input.clientId);
  await detectExperimentEvents(db, input.clientId);
  const opportunities = await refreshOpportunities(db, input.clientId, input.onError);

  await finishRunWithNote(db, input.runId, status, note);

  const agencyId = await getAgencyIdForRun(db, input.runId);
  if (agencyId) {
    await logActivity(db, {
      agencyId,
      clientId: input.clientId,
      // Прогон по расписанию делает система, а не человек.
      actorUserId: null,
      eventType: "run_finished",
      payload: {
        runId: input.runId,
        status,
        answers: written,
        expected: input.expected,
        failed: Math.max(0, input.expected - written),
      },
    });
  }

  return {
    status,
    responses: written,
    expected: input.expected,
    parsedResponses: parsed.length,
    classifiedDomains: classified.domains,
    snapshots,
    opportunities,
  };
}
