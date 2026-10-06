import type { Platform } from "./types";

/**
 * Каталог ассистентов для интерфейса.
 *
 * Продукт обещает видимость «в ответах ИИ», а покупатель под этим понимает
 * не три системы, а весь набор, которым пользуются его клиенты. Каталог
 * перечисляет их целиком и честно помечает, какие мы действительно
 * спрашиваем: у Copilot и AI Overviews публичного API нет вовсе.
 *
 * Gemini здесь нет совсем — ни измеряемым, ни выключенным. Условия Google
 * не дают его измерять (docs/open-questions/gemini-grounding.md), а
 * поверхность, которую продукт не измеряет и не собирается, не должна
 * занимать столбец в матрице клиента и строку на витрине: это обещание
 * «когда-нибудь», которого мы не давали.
 *
 * `measurable` значит «адаптер написан», а не «ключ задан»: без ключа
 * платформа просто не попадает в расписание, и по ней в матрице стоит
 * «0 из 3 нужных ответов» — это правда, а не выдуманный ноль.
 *
 * Это исключительно про отображение. `PLATFORMS` в `types.ts` — контракт C1,
 * по нему живут enum в БД, расписания и прогоны, и он остаётся тем же.
 * Неизмеряемый ассистент не может попасть ни в один знаменатель просто
 * потому, что по нему нет ни одного ответа.
 */

export interface Assistant {
  id: string;
  /** Полное имя — в подписях и легендах. */
  label: string;
  /** Короткое — в шапке матрицы, где на столбец приходится десяток пикселей. */
  short: string;
  /** Спрашиваем ли мы его на самом деле. */
  measurable: boolean;
}

export const ASSISTANTS: readonly Assistant[] = [
  { id: "chatgpt", label: "ChatGPT", short: "GPT", measurable: true },
  { id: "perplexity", label: "Perplexity", short: "Pplx", measurable: true },
  { id: "claude", label: "Claude", short: "Claude", measurable: true },
  { id: "copilot", label: "Copilot", short: "Copilot", measurable: false },
  { id: "ai-overviews", label: "Google AI Overviews", short: "AIO", measurable: false },
  /**
   * Вторая поверхность Google. Стоит рядом с AI Overviews, потому что мешает
   * им обеим одно и то же — отсутствие программного доступа к ответу (см.
   * adapters/surfaces.ts). Показывать её как «не измеряем» честнее, чем не
   * показывать вовсе: агентство видит её у своих клиентов и спрашивает о ней.
   */
  { id: "ai-mode", label: "Google AI Mode", short: "AI Mode", measurable: false },
  { id: "grok", label: "Grok", short: "Grok", measurable: true },
] as const;

/** Ассистенты, по которым есть измерения. Совпадает с `PLATFORMS` по составу. */
export function measurableAssistants(): Assistant[] {
  return ASSISTANTS.filter((assistant) => assistant.measurable);
}

export function isMeasurableAssistant(id: string): id is Platform {
  return ASSISTANTS.some((assistant) => assistant.id === id && assistant.measurable);
}
