import { PLAN_LIMITS } from "../billing/period";
import type { PlanId } from "../billing/entitlements";
import { ASSISTANTS, isMeasurableAssistant } from "../adapters/catalogue";
import { DEFAULT_PLATFORMS, PLATFORM_IDS, type Platform } from "../adapters/types";

/**
 * Что тарифу разрешено измерять.
 *
 * Отдельно от `PLAN_LIMITS` намеренно: там деньги и billing unit (клиенты и
 * проверки), их менять нельзя без решения фаундера. Здесь — объём измерения:
 * сколько вопросов на клиента, как часто и каких ассистентов можно включить.
 *
 * Значения по умолчанию равны сегодняшнему поведению продукта: ничего не
 * ограничивается сверх того, что уже ограничено, и ни одно умолчание не
 * меняется. Это точка расширения, а не новая политика.
 */

export type Cadence = "daily" | "weekly" | "biweekly";

/** Все частоты, которые понимает расписание. Порядок — от редкой к частой. */
export const CADENCES: readonly Cadence[] = ["biweekly", "weekly", "daily"] as const;

export interface MeasurementCapabilities {
  /**
   * Потолок активных вопросов на клиента. `null` — потолка нет.
   *
   * Тариф и так ограничен числом проверок в месяц: вопросы × ассистенты ×
   * сэмплы × прогоны. Второй потолок поверх этого вводится только осознанно.
   */
  promptsPerClient: number | null;
  /** Частоты, которые агентство может выбрать в расписании. */
  cadences: readonly Cadence[];
  /** Ассистенты, которых тариф позволяет включить клиенту. */
  assistants: readonly Platform[];
  /** Ассистенты, включённые у нового клиента. */
  defaultAssistants: readonly Platform[];
}

/**
 * Ассистенты, доступные на младшем тарифе.
 *
 * Три самых дешёвых ответа: Perplexity ($0.0116), Grok ($0.0220),
 * ChatGPT ($0.0242). Дорогой Claude ($0.0560) начинается с Growth:
 * разброс цены между самым дешёвым и самым дорогим почти пятикратный, и
 * на Starter он съедал бы маржу быстрее всего (docs/cost-model.md).
 *
 * Gemini здесь когда-то стоял и уехал не из-за цены: условия Google на
 * grounded-поиск запрещают анализировать результаты и строить из них
 * индекс, а продукт делает ровно это. Его больше не измеряет ни один
 * тариф (docs/open-questions/gemini-grounding.md).
 */
const STARTER_ASSISTANTS: readonly Platform[] = ["chatgpt", "perplexity", "grok"] as const;

/**
 * Ежедневный опрос — только на старшем тарифе.
 *
 * Частота самый сильный рычаг расхода: переход на еженедельный удваивает
 * число ответов, на ежедневный — умножает на 14. Именно ежедневный и
 * создаёт единственную опасную клетку модели себестоимости, поэтому он
 * и ограничен, а не что-то ещё.
 *
 * Умолчание при этом не трогается: новый клиент по-прежнему меряется раз
 * в две недели на любом тарифе.
 */
const WITHOUT_DAILY: readonly Cadence[] = ["biweekly", "weekly"] as const;

/**
 * Все, кого мы действительно спрашиваем.
 *
 * Не весь `PLATFORM_IDS`: значение остаётся в enum базы, пока по нему есть
 * записанные ответы, даже когда платформу перестали измерять. Разрешить
 * тарифу то, чего продукт не делает, значит продать несуществующее.
 */
const MEASURABLE: readonly Platform[] = PLATFORM_IDS.filter((id) =>
  ASSISTANTS.some((assistant) => assistant.id === id && assistant.measurable),
);

const ALL_ASSISTANTS: MeasurementCapabilities = {
  promptsPerClient: null,
  cadences: CADENCES,
  assistants: MEASURABLE,
  defaultAssistants: DEFAULT_PLATFORMS,
};

/**
 * Что тариф разрешает включить.
 *
 * Частоты и потолок вопросов пока одинаковы у всех: решение по ним ещё не
 * принято, и разводить их «заодно» значило бы менять поведение без
 * причины. Разведены только ассистенты.
 */
export const MEASUREMENT_CAPABILITIES: Record<PlanId, MeasurementCapabilities> = {
  starter: {
    promptsPerClient: null,
    cadences: WITHOUT_DAILY,
    assistants: STARTER_ASSISTANTS,
    // Умолчание не может предлагать то, чего тариф не разрешает.
    defaultAssistants: STARTER_ASSISTANTS,
  },
  growth: { ...ALL_ASSISTANTS, cadences: WITHOUT_DAILY },
  scale: ALL_ASSISTANTS,
};

/**
 * Кого продукт спрашивает до первой оплаты.
 *
 * Бесплатный аудит — единственное место, где мы платим за ответы, ничего
 * не получив, и единственное, у которого нет верхней границы: аккаунт
 * заводится на любой адрес, а лимит в 250 проверок считается на аккаунт.
 *
 * Grok убран отсюда по деньгам, а не по качеству. Живой замер 2026-09-29:
 * ответ Grok стоит $0.1058 — дороже всех, и это 89% цены круга по тройке.
 * С ним аудит обходится в $8.55, без него в $0.94. Разница девятикратная,
 * и платить её за посетителя, который ещё ничего не выбрал, мы не готовы.
 *
 * Список задан перечислением, а не отбором по цене: подешевей Grok
 * однажды — и бесплатный аудит молча изменился бы, хотя такого решения
 * никто не принимал. Цена проверяется тестом: он падает, когда разрыв
 * исчезает, и зовёт пересмотреть список руками.
 */
export const FREE_AUDIT_ASSISTANTS: readonly Platform[] = ["chatgpt", "perplexity"] as const;

const FREE_AUDIT_CAPABILITIES: MeasurementCapabilities = {
  ...MEASUREMENT_CAPABILITIES.starter,
  assistants: FREE_AUDIT_ASSISTANTS,
  // Умолчание не может предлагать то, чего бесплатный аудит не покрывает.
  defaultAssistants: FREE_AUDIT_ASSISTANTS,
};

/**
 * Что разрешено конкретному агентству — с учётом того, платит ли оно.
 *
 * Тариф отвечает на вопрос «что куплено», а этот — «что мы готовы дать
 * прямо сейчас». До первой оплаты это разные вещи, и спрашивать первый
 * там, где нужен второй, значит платить за Grok незнакомому человеку.
 *
 * Везде, где решается, кого спрашивать и что показать в форме, нужен
 * именно этот вызов. `capabilitiesFor` остаётся для случаев, где платность
 * не при чём: цены тарифов, витрина, поиск самого дешёвого тарифа с нужным
 * ассистентом.
 *
 * **Плательщика это не задевает, и это не случайность.** Непрошедшее
 * списание в пределах отсрочки оставляет `paying: true` — иначе у клиента
 * посреди месяца пропал бы ассистент, и видимость прыгнула бы от проблемы
 * с картой, а не от работы агентства. Отменённая подписка даёт
 * `active: false`, и такое агентство не измеряет вовсе. Значит сужение
 * достаётся ровно тем, кто ещё ни разу не платил.
 */
export function capabilitiesForAgency(entitlements: {
  plan: PlanId;
  paying: boolean;
}): MeasurementCapabilities {
  return entitlements.paying ? capabilitiesFor(entitlements.plan) : FREE_AUDIT_CAPABILITIES;
}

export function capabilitiesFor(plan: PlanId): MeasurementCapabilities {
  // Неизвестный тариф трактуется как младший: ошибка в сторону меньшего
  // расхода, а не большего.
  return MEASUREMENT_CAPABILITIES[plan] ?? MEASUREMENT_CAPABILITIES.starter;
}

/** Разрешена ли частота на этом тарифе. */
export function allowsCadence(plan: PlanId, cadence: Cadence): boolean {
  return capabilitiesFor(plan).cadences.includes(cadence);
}

/** Разрешён ли ассистент на этом тарифе. */
export function allowsAssistant(plan: PlanId, platform: Platform): boolean {
  return capabilitiesFor(plan).assistants.includes(platform);
}

/**
 * Сколько ответов в месяц даст такая настройка.
 *
 * Считает то же, что списывается со счётчика проверок: один ответ одного
 * ассистента на один вопрос. Нужна и интерфейсу (показать цену выбора), и
 * расчёту себестоимости.
 */
export function monthlyAnswers(input: {
  prompts: number;
  assistants: number;
  samplesPerPrompt: number;
  cadence: Cadence;
}): number {
  const runsPerMonth = input.cadence === "daily" ? 30 : input.cadence === "weekly" ? 4.35 : 2.17;
  return Math.round(input.prompts * input.assistants * input.samplesPerPrompt * runsPerMonth);
}

/** Сколько проверок в месяц позволяет тариф — из денежных лимитов. */
export function monthlyCheckAllowance(plan: PlanId): number {
  return PLAN_LIMITS[plan].aiCheckAllowance;
}

/**
 * Кого спросит прогон: единственное место, где это решается.
 *
 * Раньше решали трижды — функция прогона, очередь воркера и подсчёт
 * проверок перед стартом, — и решали по-разному. Когда бесплатный аудит
 * перестал включать Grok, правка попала в функцию прогона, тесты прошли, а
 * в боевом режиме прогон ставит в очередь воркер, и там стояло своё
 * «расписание или тройка по умолчанию» без тарифа и без платности. Grok
 * продолжал отвечать за наш счёт, и ни один тест этого не видел, потому
 * что проверял не тот путь.
 *
 * Из расписания отсеивается то, чего агентству сейчас не положено: тариф
 * сменился, платформу перестали измерять, аудит ещё бесплатный. Строку
 * расписания никто не переписывает — данные мы не трогаем, — поэтому
 * сверка нужна в момент прогона. Без расписания берётся умолчание.
 */
export function platformsForRun(
  capabilities: MeasurementCapabilities,
  schedulePlatforms: readonly string[] | null | undefined,
): Platform[] {
  if (!schedulePlatforms) {
    return [...capabilities.defaultAssistants];
  }
  const allowed = new Set<string>(capabilities.assistants);
  return schedulePlatforms.filter(
    (id): id is Platform => isMeasurableAssistant(id) && allowed.has(id),
  );
}

