import { ANSWER_PRICES } from "../adapters/pricing";

/**
 * Биллинговый период — календарный месяц в UTC.
 *
 * Именно UTC, а не локальная зона: агентства в разных часовых поясах,
 * и период должен считаться одинаково у воркера, API и в отчёте.
 */
export function billingPeriod(date: Date = new Date()): string {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/** Границы периода: [начало, конец) в UTC. */
export function billingPeriodBounds(period: string): { start: Date; end: Date } {
  const match = /^(\d{4})-(\d{2})$/.exec(period);
  if (!match) {
    throw new Error(`Invalid billing period "${period}". Expected YYYY-MM.`);
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) {
    throw new Error(`Invalid billing period "${period}". Month must be 01-12.`);
  }

  return {
    start: new Date(Date.UTC(year, month - 1, 1)),
    end: new Date(Date.UTC(year, month, 1)),
  };
}

/** Планы и их лимиты. Цены — из спека (§13 startup-spec). */
export interface PlanLimits {
  clientLimit: number;
  aiCheckAllowance: number;
  priceUsd: number;
}

/**
 * Одна проверка — один ответ одной платформы на один промпт.
 *
 * Клиент при обычной работе (24 промпта × 3 сэмпла × 2 ассистента по
 * умолчанию, недельные прогоны) расходует ≈624 проверки в месяц. Было 935 при
 * Grok в умолчании; с 07.10.2026 Grok включается вручную и весит 5 проверок. Allowance выставлен с запасом ~40% к этому расходу, а не «на
 * глаз»: прежние 6 000 / 25 000 / 70 000 обещали втрое больше, чем продукт
 * потребляет, и клиент, забравший обещанное на дорогом плане, обошёлся бы в
 * $2 396 из уплаченных $2 499. Оффер не должен обещать то, что разоряет.
 */
export const CHECKS_PER_CLIENT_MONTH = 624;

/**
 * Во что обходится один ответ ChatGPT — единственный живой замер в проекте.
 *
 * 2026-08-12, reasoning=medium: $0.0242, из них около четырёх пятых —
 * вызовы веб-поиска. Здесь стояло $0.0247, и оно расходилось с самим
 * адаптером, с фикстурами и с моделью себестоимости; никто не мог сказать,
 * откуда взялась разница. Цифра теперь одна и лежит там же, где цены
 * остальных ассистентов.
 *
 * Средней ценой ответа это не является и называться не должно: ассистенты
 * различаются почти впятеро. Оценка расхода по набору считается в
 * `answersCostUsd`, а настоящая стоимость каждого ответа пишется в БД
 * самим адаптером.
 */
export const ESTIMATED_COST_PER_ANSWER_USD = ANSWER_PRICES.chatgpt.usd;

export const PLAN_LIMITS: Record<"starter" | "growth" | "scale", PlanLimits> = {
  starter: { clientLimit: 3, aiCheckAllowance: 4_000, priceUsd: 499 },
  growth: { clientLimit: 10, aiCheckAllowance: 13_000, priceUsd: 1_299 },
  scale: { clientLimit: 25, aiCheckAllowance: 28_500, priceUsd: 2_499 },
};

export interface UsageStatus {
  used: number;
  allowance: number;
  /** Доля израсходованного, 0..1+ (может превысить 1 — это overage, а не ошибка). */
  ratio: number;
  overAllowance: boolean;
}

export function usageStatus(used: number, allowance: number): UsageStatus {
  const ratio = allowance > 0 ? used / allowance : 0;
  return { used, allowance, ratio, overAllowance: used > allowance };
}
