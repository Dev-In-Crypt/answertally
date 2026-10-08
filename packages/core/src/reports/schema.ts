import { z } from "zod";

/**
 * Контракт C4 — то, что видит конечный клиент агентства.
 *
 * Схема жёсткая намеренно: отчёт уходит наружу, и любое поле, которое можно
 * заполнить свободным текстом, рано или поздно заполнят обещанием. Поэтому
 * оценка вклада — строка вида «+4–6 pp» рядом с уровнем уверенности,
 * а не число, притворяющееся точным.
 */

/**
 * Как делается работа и как увидеть результат (08.10.2026) — из плейбуков,
 * чтобы клиент агентства понимал, что именно будет сделано. Необязательные:
 * отчёты, выпущенные раньше, остаются валидными.
 */
const howItIsDone = {
  steps: z.array(z.string().min(1)).max(8).optional(),
  check: z.array(z.string().min(1)).max(4).optional(),
};

export const reportPayloadSchema = z.object({
  client: z.object({ name: z.string().min(1) }),
  period: z.object({
    start: z.string(),
    end: z.string(),
  }),
  visibility: z.object({
    before: z.number(),
    after: z.number(),
  }),
  /** Процентные пункты; отрицательное значение = клиент отстаёт. */
  competitorGap: z.object({
    before: z.number(),
    after: z.number(),
  }),
  workCompleted: z.array(z.object({ label: z.string().min(1), count: z.number().int().min(0) })),
  results: z.object({
    newCitedUrls: z.number().int().min(0),
    newBrandMentions: z.number().int().min(0),
    /**
     * Сколько ответов собрано за период (без контрольных вопросов). Есть —
     * значит `newBrandMentions` = ответы, где назван клиент, и строка читается
     * «X из N». Нет — старый отчёт, где там лежало число строк упоминаний.
     */
    sampledAnswers: z.number().int().min(0).optional(),
    /**
     * null — сравнивать было нечем: внутри периода не осталось ассистента,
     * которого мерили и в начале, и в конце. Ноль означал бы «не изменилось»,
     * а это другое утверждение. Уже сохранённые отчёты несут число и остаются
     * валидными.
     */
    visibilityDeltaPp: z.number().nullable(),
  }),
  highestImpactAction: z
    .object({
      title: z.string().min(1),
      /** Всегда диапазон и всегда «estimated» — см. инвариант 2. */
      estimatedContribution: z.string().min(1),
      confidence: z.enum(["low", "medium", "high"]),
    })
    .nullable(),
  nextSprint: z.array(z.string().min(1)),
  /**
   * Что стоит сделать дальше и почему. Приходит из найденных возможностей.
   *
   * Внутренняя оценка (0–100) сюда НЕ попадает намеренно: это инструмент
   * сортировки работ для агентства, а в отчёте клиенту она читалась бы как
   * оценка его сайта по стобалльной шкале — и разговор, который за этим
   * следует, агентству не нужен.
   */
  topOpportunities: z
    .array(
      z.object({
        title: z.string().min(1),
        /** Инвариант 7: без объяснения пункт в отчёт не попадает. */
        reason: z.string().min(1),
        affectedPrompts: z.number().int().nonnegative(),
        evidence: z.enum(["low", "medium", "high"]),
        ...howItIsDone,
      }),
    )
    .max(5)
    .optional(),
  /**
   * Чему научились: что запускали и что за этим наблюдалось. Формулировки —
   * только наблюдение и его предел, никакой атрибуции причины.
   */
  whatWeLearned: z
    .array(
      z.object({
        title: z.string().min(1),
        observed: z.string().min(1),
        confidence: z.enum(["low", "medium", "high"]),
      }),
    )
    .max(5)
    .optional(),
  /**
   * Раздел бесплатного аудита. Есть только в отчёте по проспекту: у платящего
   * клиента отчёт показывает сделанное, а не предложение.
   *
   * Имя ключа заморожено контрактом C4: под ним лежат уже сохранённые payload'ы
   * отчётов, и переименование сделало бы их неразбираемыми. Собирается он
   * функцией buildAuditProposal и означает коммерческое предложение, а НЕ
   * доменную сущность Opportunity из packages/core/src/opportunities/.
   */
  /**
   * За период есть только одно измерение: «было» и «стало» — одно и то же
   * число, и «+0 pp» клиент прочёл бы как «работа ничего не дала». Отчёт
   * тогда показывает одну цифру и говорит, что сравнение будет дальше.
   * Необязательное: старые payload'ы без поля читаются как раньше.
   */
  firstMeasurement: z.boolean().optional(),
  opportunity: z
    .object({
      currentVisibilityPct: z.number().min(0).max(100),
      competitorAverageVisibilityPct: z.number().min(0).max(100),
      /** Отрицательное значение = клиент отстаёт от средней по конкурентам. */
      gapPp: z.number(),
      rankedActions: z
        .array(
          z.object({
            title: z.string().min(1),
            /** Инвариант 7: рекомендация без причины не собирается. */
            reason: z.string().min(1),
            estimatedImpact: z.enum(["low", "medium", "high"]),
            effort: z.enum(["low", "medium", "high"]),
            ...howItIsDone,
          }),
        )
        .max(20),
      scopeDays: z.number().int().positive(),
      suggestedRetainerUsd: z.number().int().positive(),
      estimatedEffortHours: z.object({
        min: z.number().positive(),
        max: z.number().positive(),
      }),
      /** Диапазон, а не точка: маржа зависит от часов, которые ещё не потрачены. */
      estimatedMarginPct: z.object({
        min: z.number(),
        max: z.number(),
      }),
    })
    .nullable()
    .default(null),
  /**
   * Что изменилось по отдельным вопросам.
   *
   * Общая цифра на вопрос «что изменилось» не отвечает: она может стоять на
   * месте, пока один вопрос вырос, а другой просел. Поле необязательное —
   * отчёты, выпущенные до его появления, остаются валидными: payload
   * хранится неизменным, и клиент видел ровно то, что видел.
   */
  movement: z
    .array(
      z.object({
        prompt: z.string().min(1),
        /** Процентные пункты против прошлого окна той же длины. */
        deltaPp: z.number(),
        /** Доля на конец периода. */
        sharePct: z.number().min(0).max(100),
      }),
    )
    .max(20)
    .optional(),
  /**
   * Переходы от ассистентов за период.
   *
   * Отдельный раздел, а не строка рядом с видимостью: это другое наблюдение,
   * из аналитики клиента, и оно недосчитывается. Раздела нет вовсе, если
   * данных не импортировали — пустая таблица читалась бы как «переходов нет».
   */
  assistantTraffic: z
    .object({
      totalSessions: z.number().int().min(0),
      byAssistant: z
        .array(
          z.object({
            assistant: z.string().min(1),
            sessions: z.number().int().min(0),
          }),
        )
        .max(10),
    })
    .optional(),
  /**
   * Данные для диаграмм отчёта (08.10.2026). Все три необязательные: отчёты,
   * выпущенные раньше, хранятся неизменными и показываются без диаграмм.
   *
   * Доля по каждому ассистенту на конец периода — те же клетки, из которых
   * собрана общая цифра, а не отдельный расчёт.
   */
  byAssistant: z
    .array(
      z.object({
        assistant: z.string().min(1),
        sharePct: z.number().min(0).max(100),
        answers: z.number().int().min(0),
      }),
    )
    .max(10)
    .optional(),
  /** Доли отслеживаемых конкурентов на конец периода, по убыванию. */
  competitors: z
    .array(z.object({ name: z.string().min(1), sharePct: z.number().min(0).max(100) }))
    .max(5)
    .optional(),
  /**
   * Недельные точки доли клиента. Только когда весь период мерили одним
   * набором ассистентов: иначе линия соединяла бы разные знаменатели.
   */
  trend: z
    .array(z.object({ weekStart: z.string(), sharePct: z.number().min(0).max(100) }))
    .max(60)
    .optional(),
  /**
   * Сколько поисков Google показали AI Overview. Есть только у клиентов,
   * которых мерили на AI Overviews: без блока покупатель читает обычную
   * выдачу, и доля клиента в нём значит меньше.
   */
  googleOverviews: z
    .object({ shown: z.number().int().min(0), searches: z.number().int().min(1) })
    .optional(),
  /** Оговорки, которые обязаны дойти до клиента вместе с цифрами. */
  caveats: z.array(z.string().min(1)),
});

export type ReportPayload = z.infer<typeof reportPayloadSchema>;
