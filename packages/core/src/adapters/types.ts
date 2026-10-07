import { z } from "zod";

/** Контракт C1 (TASKS.md). Менять только осознанно, с обновлением TASKS.md. */

/**
 * Литеральный кортеж, а не только `PLATFORMS`: zod-схемы входа выводят из
 * него union, а из `readonly Platform[]` вывели бы `string[]` и потеряли его.
 */
// Поверхности Google (07.10.2026) — через поставщика выдачи, см. adapters/dataforseo.
export const PLATFORM_IDS = ["chatgpt", "perplexity", "gemini", "claude", "grok", "ai-overviews", "ai-mode"] as const;

export type Platform = (typeof PLATFORM_IDS)[number];

/** Все платформы, которые умеет система: по ним живут enum в БД и очереди. */
export const PLATFORMS: readonly Platform[] = PLATFORM_IDS;

/**
 * Набор по умолчанию — там, где расписания нет: разовый аудит и ручной
 * запуск. Это запускная тройка, а не весь `PLATFORMS`: у новой платформы
 * может не быть ключа (в live-режиме прогон по ней упадёт целиком), и она
 * стоит денег, о которых агентство не просило. Включается платформа
 * осознанно — галочкой в расписании клиента.
 */
export const DEFAULT_PLATFORMS: readonly Platform[] = [
  "chatgpt",
  "perplexity",
  // Решения фаундера 07.10.2026: Grok вышел из умолчания (самый дорогой,
  // весит 5 проверок), AI Overviews вошёл (ответ над выдачей Google видят
  // все, и он стоит $0.002).
  "ai-overviews",
] as const;

export interface Citation {
  url: string;
  title?: string;
}

export interface AdapterResult {
  text: string;
  citations: Citation[];
  modelVersion: string;
  costUsd: number;
  latencyMs: number;
}

export interface AdapterOptions {
  geo?: string;
  lang?: string;
  /**
   * Номер сэмпла. Живые адаптеры его игнорируют — ассистент и так отвечает
   * каждый раз по-своему. Фикстурам он нужен, чтобы повторные сэмплы одного
   * вопроса различались: иначе доля в mock-режиме может быть только 0% или
   * 100%, и весь смысл повторных замеров пропадает ещё до продакшена.
   */
  sampleIndex?: number;
}

export interface PlatformAdapter {
  platform: Platform;
  execute(prompt: string, opts?: AdapterOptions): Promise<AdapterResult>;
}

/** Рантайм-проверка формы ответа адаптера: живые API меняются без предупреждения. */
export const citationSchema = z.object({
  url: z.url(),
  title: z.string().optional(),
});

export const adapterResultSchema = z.object({
  text: z.string().min(1),
  citations: z.array(citationSchema),
  modelVersion: z.string().min(1),
  costUsd: z.number().nonnegative(),
  latencyMs: z.number().nonnegative(),
});
