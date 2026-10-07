import type { PromptIntent } from "../import/csv";

/**
 * Генерация набора покупательских промптов по домену и индустрии.
 *
 * Интерфейс отделён от реализации по той же причине, что и адаптеры платформ:
 * в mock-режиме промпты собираются из шаблонов (детерминированно и без сети),
 * в live-режиме их предложит модель. Список в обоих случаях правится человеком
 * до сохранения — это черновик, а не готовая конфигурация измерения.
 */

export interface PromptSeed {
  /** Домен клиента: используется как запасной источник названия категории. */
  domain: string;
  /** Категория, в которой клиента ищут покупатели: «CRM software», «payroll». */
  industry: string;
  brandNames: readonly string[];
  competitorNames: readonly string[];
}

export interface GeneratedPrompt {
  text: string;
  intent: PromptIntent;
  /** Имя кластера, в который промпт попадёт при сохранении. */
  cluster: string;
  /**
   * Контрольные промпты остаются нетронутыми в экспериментах: без группы
   * сравнения вклад действия оценить нечем (контракт C5).
   */
  isControl: boolean;
}

export interface PromptGenerator {
  generate(seed: PromptSeed, count: number): Promise<GeneratedPrompt[]>;
}

// Нижняя граница 12: бесплатный аудит берёт 16 вопросов (FREE_AUDIT_PROMPT_COUNT).
export const GENERATED_PROMPT_RANGE = { min: 12, max: 30 } as const;
export const DEFAULT_GENERATED_PROMPT_COUNT = 24;

const CLUSTERS = {
  learning: "Learning the category",
  comparison: "Comparison",
  purchase: "Purchase intent",
  control: "Control (untouched)",
} as const;

/** «CRM software» → «crm software»; пустое поле — падать не должно. */
function categoryOf(seed: PromptSeed): string {
  const industry = seed.industry.trim();
  if (industry) return industry.toLowerCase();

  // Домен — последний рубеж: «acmecrm.test» лучше, чем пустая строка в промпте.
  const label = seed.domain.split(".")[0] ?? seed.domain;
  return label.toLowerCase();
}

function brandOf(seed: PromptSeed): string {
  return seed.brandNames[0]?.trim() || seed.domain;
}

/**
 * Уточнения, которые читаются в любой категории.
 *
 * Прежний набор был написан под SaaS («for startups», «free trial», «easiest
 * to migrate to»), и первый живой аудит кроссовок спросил ассистентов о
 * «best running shoes for startups». Вопрос, которого покупатель не задаёт,
 * меряет не видимость, а странность вопроса.
 */
const QUALIFIERS = ["for beginners", "on a budget", "for professionals", "according to reviews"] as const;

function learningPrompts(category: string): string[] {
  return [
    `how to choose ${category}`,
    `what to look for in ${category}`,
    `common mistakes when buying ${category}`,
    `is expensive ${category} worth it`,
    `what matters most in ${category}`,
    `${category} buying guide`,
  ];
}

function comparisonPrompts(category: string, brand: string, competitors: readonly string[]): string[] {
  const prompts = [
    `best ${category}`,
    ...QUALIFIERS.map((qualifier) => `best ${category} ${qualifier}`),
    `most recommended ${category} right now`,
  ];

  for (const competitor of competitors) {
    prompts.push(`${brand} vs ${competitor}`);
    prompts.push(`alternatives to ${competitor}`);
  }

  return prompts;
}

function purchasePrompts(category: string): string[] {
  return [
    `cheapest ${category} that is still good`,
    `best value ${category}`,
    `most reliable ${category} brand`,
    `which ${category} has the best reviews`,
    `where to buy ${category}`,
    `${category} worth paying more for`,
  ];
}

/**
 * Контрольные промпты намеренно не упоминают ни клиента, ни конкурентов:
 * если действие агентства сдвигает и их, дело не в действии.
 */
function controlPrompts(category: string): string[] {
  return [
    `how much does ${category} usually cost`,
    `${category} glossary of terms`,
    `history of ${category}`,
    `${category} industry trends`,
    `how ${category} has changed in recent years`,
  ];
}

interface Candidate {
  text: string;
  intent: PromptIntent;
  cluster: string;
  isControl: boolean;
}

/**
 * Кандидаты идут по кругу между намерениями: если список обрезать до 20,
 * покупательские и обучающие промпты останутся в наборе оба.
 */
export function buildPromptCandidates(seed: PromptSeed): Candidate[] {
  const category = categoryOf(seed);
  const brand = brandOf(seed);
  const competitors = seed.competitorNames.map((name) => name.trim()).filter(Boolean);

  const groups: Candidate[][] = [
    comparisonPrompts(category, brand, competitors).map((text) => ({
      text,
      intent: "comparison" as const,
      cluster: CLUSTERS.comparison,
      isControl: false,
    })),
    learningPrompts(category).map((text) => ({
      text,
      intent: "learning" as const,
      cluster: CLUSTERS.learning,
      isControl: false,
    })),
    purchasePrompts(category).map((text) => ({
      text,
      intent: "purchase" as const,
      cluster: CLUSTERS.purchase,
      isControl: false,
    })),
    controlPrompts(category).map((text) => ({
      text,
      intent: "other" as const,
      cluster: CLUSTERS.control,
      isControl: true,
    })),
  ];

  const ordered: Candidate[] = [];
  const seen = new Set<string>();
  const longest = Math.max(...groups.map((group) => group.length));

  for (let index = 0; index < longest; index++) {
    for (const group of groups) {
      const candidate = group[index];
      if (!candidate) continue;
      const key = candidate.text.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      ordered.push(candidate);
    }
  }

  return ordered;
}

export function clampPromptCount(count: number): number {
  return Math.min(GENERATED_PROMPT_RANGE.max, Math.max(GENERATED_PROMPT_RANGE.min, count));
}

/**
 * Шаблонный генератор: детерминированный, без сети, годится и как mock,
 * и как запасной вариант, когда модель недоступна.
 */
export class TemplatePromptGenerator implements PromptGenerator {
  generate(seed: PromptSeed, count = DEFAULT_GENERATED_PROMPT_COUNT): Promise<GeneratedPrompt[]> {
    return Promise.resolve(generatePromptsFromTemplates(seed, count));
  }
}

export function generatePromptsFromTemplates(
  seed: PromptSeed,
  count: number = DEFAULT_GENERATED_PROMPT_COUNT,
): GeneratedPrompt[] {
  return buildPromptCandidates(seed).slice(0, clampPromptCount(count));
}
