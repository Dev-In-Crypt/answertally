import type { ActionType } from "../diagnosis/recommendations";

/**
 * План на 90 дней — из найденных возможностей, а не из головы.
 *
 * Это принципиально. Универсальный «SEO-план на квартал» агентство может
 * написать само за полчаса, и он ничего не стоит. Ценность здесь в том, что
 * каждая задача привязана к измеренному разрыву: видно, откуда она взялась,
 * сколько вопросов затрагивает и на каком объёме данных это посчитано.
 *
 * Порядок месяцев — не календарь, а последовательность работы: сначала то,
 * что под контролем и уже читается моделями, потом внешние площадки, потом
 * проверка того, что из этого сдвинулось. Ни одна формулировка не обещает
 * результата: раздел называется «что делаем», а не «что получим».
 */

export const PLAN_PHASES = [
  {
    key: "foundation",
    title: "Month 1: Foundation",
    /** Что клиент контролирует сам: собственные страницы и техника. */
    actionTypes: [
      "refresh_page",
      "create_page",
      "technical_fix",
      "structured_data_fix",
      "crawler_fix",
      "product_data_update",
    ],
  },
  {
    key: "expansion",
    title: "Month 2: Expansion",
    /** Чужие площадки: дольше по сроку и зависит не только от нас. */
    actionTypes: ["review_platform", "source_outreach", "pr_editorial", "ugc_community"],
  },
] as const satisfies readonly { key: string; title: string; actionTypes: readonly ActionType[] }[];

export const VALIDATION_PHASE = {
  key: "validation",
  title: "Month 3: Validation",
} as const;

export interface PlanInput {
  title: string;
  reason: string;
  actionType: ActionType;
  affectedPrompts: number;
  evidence: "low" | "medium" | "high";
  /** Что мы рассчитываем увидеть — сигнал, а не обещанная величина. */
  expectedSignal: string;
}

export interface PlanTask {
  title: string;
  reason: string;
  affectedPrompts: number;
  evidence: "low" | "medium" | "high";
  expectedSignal: string;
}

export interface PlanPhase {
  key: string;
  title: string;
  tasks: PlanTask[];
}

/** Какой сигнал вообще может появиться от работы этого типа. */
export function expectedSignalFor(actionType: ActionType): string {
  switch (actionType) {
    case "refresh_page":
    case "create_page":
      return "The page starts being cited, and the brand is named in answers that cite it.";
    case "technical_fix":
    case "crawler_fix":
    case "structured_data_fix":
      return "Pages that were not being read start appearing among cited sources.";
    case "product_data_update":
      return "Product details in answers match what the client actually offers.";
    case "review_platform":
      return "The client appears on the platform, and in answers that cite it.";
    case "source_outreach":
    case "pr_editorial":
      return "The source starts naming the client in the answers where it is already cited.";
    case "ugc_community":
      return "The brand appears in community threads models already read.";
  }
}

export const PLAN_MAX_TASKS_PER_PHASE = 5;

/**
 * Раскладывает работы по фазам. Порядок внутри фазы — тот, в котором пришли
 * возможности: они уже отсортированы движком по оценке.
 */
export function buildNinetyDayPlan(inputs: readonly PlanInput[]): PlanPhase[] {
  const used = new Set<number>();

  const phases: PlanPhase[] = PLAN_PHASES.map((phase) => {
    const tasks: PlanTask[] = [];

    inputs.forEach((input, index) => {
      if (used.has(index) || tasks.length >= PLAN_MAX_TASKS_PER_PHASE) return;
      if (!(phase.actionTypes as readonly string[]).includes(input.actionType)) return;

      used.add(index);
      tasks.push({
        title: input.title,
        reason: input.reason,
        affectedPrompts: input.affectedPrompts,
        evidence: input.evidence,
        expectedSignal: input.expectedSignal,
      });
    });

    return { key: phase.key, title: phase.title, tasks };
  });

  /**
   * Третий месяц — не новый список работ, а проверка первых двух. Придумывать
   * туда задачи значило бы обещать работу, которой ещё нет оснований.
   */
  const planned = phases.reduce((total, phase) => total + phase.tasks.length, 0);
  const validation: PlanPhase = {
    key: VALIDATION_PHASE.key,
    title: VALIDATION_PHASE.title,
    tasks:
      planned === 0
        ? []
        : [
            {
              title: "Re-measure and evaluate what moved",
              reason: `Movement on the ${planned} items above is measured against the baseline taken before the work, with the questions that were not touched as a comparison group.`,
              affectedPrompts: inputs.reduce((total, input) => total + input.affectedPrompts, 0),
              evidence: "medium",
              expectedSignal:
                "Where movement is larger than the sample can explain on its own, it is reported; where it is not, it is left out.",
            },
          ],
  };

  return [...phases, validation].filter((phase) => phase.tasks.length > 0);
}
