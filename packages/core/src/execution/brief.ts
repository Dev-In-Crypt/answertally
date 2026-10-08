import type { ActionType, RecommendationEvidence } from "../diagnosis/recommendations";
import { playbookFor } from "./playbooks";

/**
 * Бриф: рекомендация, развёрнутая в рабочее задание.
 *
 * Интерфейс отделён от реализации по той же причине, что адаптеры платформ и
 * генератор промптов: шаблонная сборка детерминирована и работает без сети и
 * без ключей, а модель может уточнить детали поверх — но базовый путь не
 * должен от неё зависеть.
 *
 * Бриф не публикует и не отправляет ничего (инвариант 4) и не пишет текст
 * страницы за агентство (инвариант 5): он говорит, что должно получиться и
 * как это проверить.
 */

export interface ActionBrief {
  /** Что нужно получить — одна фраза, без обещаний результата в выдаче. */
  objective: string;
  /** Почему это в очереди: тот же reason, что и у действия. */
  why: string;
  /** Числа из измерения, на которых стоит задание. */
  context: string[];
  steps: string[];
  acceptance: string[];
  pitfalls: string[];
  /** Как увидеть результат в следующих замерах — без обещания, что он будет. */
  verify: string[];
}

export interface BriefInput {
  actionType: ActionType;
  title: string;
  reason: string;
  sourceDomain?: string | null;
  evidence?: RecommendationEvidence | null;
  /** Сколько кластеров затронуто — задание касается их все. */
  affectedClusterCount?: number;
}

function contextLines(input: BriefInput): string[] {
  const lines: string[] = [];
  const evidence = input.evidence;
  const domain = input.sourceDomain;

  if (domain && evidence?.sharePct !== undefined && evidence.citations !== undefined) {
    lines.push(
      `${domain} is cited in ${evidence.sharePct}% of measured answers for this topic (${evidence.citations} citations).`,
    );
  } else if (domain) {
    lines.push(`${domain} is among the sources cited for this topic.`);
  }

  if (evidence?.competitorsPresent && evidence.competitorsPresent.length > 0) {
    lines.push(
      `Present there today: ${evidence.competitorsPresent.join(", ")}. The client is not.`,
    );
  }

  if (evidence?.influentialCount !== undefined) {
    lines.push(
      `No page from the client's own domain appears among the ${evidence.influentialCount} sources cited here.`,
    );
  }

  if (input.affectedClusterCount && input.affectedClusterCount > 1) {
    lines.push(`This work covers ${input.affectedClusterCount} prompt clusters.`);
  }

  // Пустой контекст честнее выдуманного: действие могло быть заведено вручную.
  return lines;
}

function objectiveFor(input: BriefInput): string {
  const domain = input.sourceDomain;

  switch (input.actionType) {
    case "review_platform":
    case "source_outreach":
      return domain
        ? `Get the client listed on ${domain} with a complete, public profile.`
        : "Get the client listed with a complete, public profile.";
    case "pr_editorial":
      return domain
        ? `Get the client named in coverage on ${domain}.`
        : "Get the client named in editorial coverage.";
    case "ugc_community":
      return domain
        ? `Take part in the ${domain} threads where this question is asked.`
        : "Take part in the community threads where this question is asked.";
    case "create_page":
      return "Publish a page on the client's domain that answers this cluster directly.";
    case "refresh_page":
      return domain
        ? `Update ${domain} so the answering passages carry the brand and current facts.`
        : "Update the page so the answering passages carry the brand and current facts.";
    case "technical_fix":
      return "Make the answering content reachable in the raw response.";
    case "structured_data_fix":
      return "Make the page's markup state the same facts as its visible text.";
    case "crawler_fix":
      return "Agree the crawler rules with the client and apply them.";
    case "product_data_update":
      return "Bring product facts up to date at the source and in the listings that repeat them.";
  }
}

/**
 * Как проверить, что работа дошла до ответов. Только то, что продукт сам
 * покажет в следующих замерах: «стало лучше» он не обещает (инвариант 2).
 */
export function verifyLines(actionType: ActionType, sourceDomain?: string | null): string[] {
  const first =
    sourceDomain && actionType !== "create_page"
      ? `In the next measurements, check whether answers that cite ${sourceDomain} now name the client.`
      : actionType === "create_page" || actionType === "refresh_page"
        ? "In the next measurements, check whether the client's own page is cited for these questions and whether those answers name the client."
        : "In the next measurements, check whether answers to the affected questions name the client more often.";
  return [
    first,
    "Allow four to eight weeks: assistants pick up new pages and coverage slowly, and one week moves within the range.",
  ];
}

/** Детерминированная сборка: одинаковый вход — одинаковый бриф. */
export function buildBriefFromTemplate(input: BriefInput): ActionBrief {
  const playbook = playbookFor(input.actionType);

  return {
    objective: objectiveFor(input),
    why: input.reason,
    context: contextLines(input),
    steps: [...playbook.steps],
    acceptance: [...playbook.acceptance],
    pitfalls: [...(playbook.pitfalls ?? [])],
    verify: verifyLines(input.actionType, input.sourceDomain),
  };
}

export interface BriefWriter {
  write(input: BriefInput): Promise<ActionBrief>;
}

/**
 * Шаблонный автор брифа: без сети и без ключей.
 * Годится и как основной путь, и как запасной, когда модель недоступна.
 */
export class TemplateBriefWriter implements BriefWriter {
  write(input: BriefInput): Promise<ActionBrief> {
    return Promise.resolve(buildBriefFromTemplate(input));
  }
}
