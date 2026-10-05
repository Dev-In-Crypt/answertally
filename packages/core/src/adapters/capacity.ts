import { ASSISTANTS } from "./catalogue";
import { platformLabel } from "../copy";
import { answersCostUsd } from "./pricing";
import { PLATFORM_IDS, type Platform } from "./types";
import { ESTIMATED_COST_PER_ANSWER_USD } from "../billing/period";
import type { PlanId } from "../billing/entitlements";
import {
  CADENCES,
  capabilitiesFor,
  monthlyAnswers,
  monthlyCheckAllowance,
  type Cadence,
  FREE_AUDIT_ASSISTANTS,
  type MeasurementCapabilities,
} from "../config/measurement";

/**
 * Что тариф позволяет измерять — в виде, пригодном и для сервера, и для экрана.
 *
 * Сама политика живёт в `config/measurement.ts` и сегодня одинакова для всех
 * тарифов. Здесь она не повторяется и не уточняется: этот файл только читает
 * её и превращает в два ответа — «можно ли так» и «во что это обойдётся».
 *
 * Почему отдельный модуль, а не проверка внутри роутера: одну и ту же политику
 * применяют два места — форма расписания (не показать то, чего нельзя) и
 * `saveSchedule` (не дать сохранить то, чего нельзя). Разойдись они, агентство
 * увидело бы галочку, которую сервер молча отвергает.
 *
 * Все функции чистые и принимают возможности параметром: тариф с ограничением
 * можно проверить тестом, не трогая умолчания, которые менять нельзя.
 */

/**
 * Реэкспорт, а не второе определение: потребителю нужен один вход, а тип
 * частоты и форма возможностей остаются заданными в конфиге.
 */
export type { Cadence, MeasurementCapabilities } from "../config/measurement";

export const CADENCE_LABELS: Record<Cadence, string> = {
  biweekly: "Every two weeks",
  weekly: "Weekly",
  daily: "Daily",
};

/** Частота ли это вообще. Список берётся из конфига, а не переписывается здесь. */
export function isCadence(value: string): value is Cadence {
  return (CADENCES as readonly string[]).includes(value);
}

export type CapacityRefusalCode = "cadence" | "assistant" | "prompt-cap";

export interface CapacityRefusal {
  code: CapacityRefusalCode;
  /** Текст для человека: что именно не разрешено и что разрешено вместо этого. */
  message: string;
}

export interface ScheduleRequest {
  cadence: Cadence;
  assistants: readonly Platform[];
  /**
   * Сколько активных вопросов у клиента. Нужен только для потолка промптов;
   * потолка сегодня нет (`promptsPerClient: null`), и поле можно не передавать.
   */
  promptCount?: number;
}

/**
 * Имя ассистента для текста отказа.
 *
 * Каталог знает только тех, кого продукт показывает. В отказе же может
 * оказаться и тот, кого там нет: расписание переживает решение перестать
 * измерять платформу, и запрос на её сохранение надо отклонить по-человечески,
 * а не строчным идентификатором.
 */
function assistantLabel(id: string): string {
  return ASSISTANTS.find((assistant) => assistant.id === id)?.label ?? platformLabel(id);
}

/**
 * Перечисление для предложения: «A», «A and B», «A, B and C».
 *
 * Простое соединение запятой читалось терпимо, пока наборов было три, и
 * сломалось на двух: «what ChatGPT, Perplexity say about it» — это уже не
 * английский. Строки отсюда попадают и на витрину, и в отказ формы.
 */
function listed(items: readonly string[]): string {
  if (items.length === 0) return "none";
  if (items.length === 1) return items[0]!;
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)!}`;
}

/**
 * Первая причина, по которой такое расписание сохранять нельзя, или `null`.
 *
 * Возвращается именно первая, а не все: форма всё равно показывает одну
 * строку, а перечисление всех нарушений сразу читается как придирка.
 */
export function refuseSchedule(
  capabilities: MeasurementCapabilities,
  request: ScheduleRequest,
): CapacityRefusal | null {
  if (!capabilities.cadences.includes(request.cadence)) {
    return {
      code: "cadence",
      message: `${CADENCE_LABELS[request.cadence]} checks are not part of this plan. Available: ${listed(
        capabilities.cadences.map((cadence) => CADENCE_LABELS[cadence].toLowerCase()),
      )}.`,
    };
  }

  const blocked = request.assistants.filter(
    (assistant) => !capabilities.assistants.includes(assistant),
  );
  if (blocked.length > 0) {
    return {
      code: "assistant",
      message: `${listed(blocked.map(assistantLabel))} ${
        blocked.length === 1 ? "is" : "are"
      } not part of this plan. Available: ${listed(capabilities.assistants.map(assistantLabel))}.`,
    };
  }

  const cap = capabilities.promptsPerClient;
  if (cap !== null && request.promptCount !== undefined && request.promptCount > cap) {
    return {
      code: "prompt-cap",
      message: `This plan measures up to ${cap} prompts per client; this client has ${request.promptCount} active.`,
    };
  }

  return null;
}

/** То же по идентификатору тарифа — путь для роутера. */
export function refuseScheduleForPlan(
  plan: PlanId,
  request: ScheduleRequest,
): CapacityRefusal | null {
  return refuseSchedule(capabilitiesFor(plan), request);
}

export interface CapacityEstimate {
  /** Сколько ответов в месяц даст такая настройка. */
  answersPerMonth: number;
  /** Сколько проверок в месяц даёт тариф. */
  allowance: number;
  /** Доля месячного лимита, 0..1+. Больше 1 — перерасход, а не ошибка. */
  ratio: number;
  overAllowance: boolean;
  /**
   * Оценка расхода на измерение — по цене каждого выбранного ассистента.
   *
   * Раньше считалось по одной цифре на всех, и это была цена ответа ChatGPT:
   * набор из дорогих ассистентов занижался вдвое. Своих чисел здесь нет —
   * они в `ANSWER_PRICES`, а настоящая стоимость каждого ответа пишется в
   * БД адаптером.
   */
  estimatedCostUsd: number;
}

export const ESTIMATE_BASIS = {
  costPerAnswerUsd: ESTIMATED_COST_PER_ANSWER_USD,
} as const;

/**
 * Во что обойдётся выбранная настройка за месяц.
 *
 * Считается до сохранения: агентство должно видеть цену выбора «давайте
 * измерять почаще» раньше, чем нажмёт «Save». Все цифры — оценка.
 */
export function estimateSchedule(input: {
  plan: PlanId;
  prompts: number;
  /**
   * Именно список, а не количество.
   *
   * Число ответов от личности ассистента не зависит, а деньги зависят сильно:
   * между самым дешёвым и самым дорогим почти пятикратная разница. Пока сюда
   * приходило количество, цена набора была неотличима от цены любого другого
   * набора того же размера.
   */
  assistants: readonly Platform[];
  samplesPerPrompt: number;
  cadence: Cadence;
}): CapacityEstimate {
  const answersPerMonth = monthlyAnswers({
    prompts: input.prompts,
    assistants: input.assistants.length,
    samplesPerPrompt: input.samplesPerPrompt,
    cadence: input.cadence,
  });
  const allowance = monthlyCheckAllowance(input.plan);

  // Ответов на одного ассистента за месяц: общее число делится поровну,
  // потому что каждый отвечает на каждый вопрос в каждом прогоне.
  const answersEach = input.assistants.length > 0 ? answersPerMonth / input.assistants.length : 0;

  return {
    answersPerMonth,
    allowance,
    ratio: allowance > 0 ? answersPerMonth / allowance : 0,
    overAllowance: answersPerMonth > allowance,
    estimatedCostUsd: answersCostUsd(input.assistants, answersEach),
  };
}

export interface CapacityOption<T extends string> {
  id: T;
  label: string;
}

export interface AssistantOption extends CapacityOption<Platform> {
  /** Разрешён ли он агентству прямо сейчас. */
  allowed: boolean;
  /** Самый дешёвый тариф, на котором он включается. Есть только у запертых. */
  unlocksOn?: PlanId;
  /**
   * Тариф его даёт, но агентство ещё не платило.
   *
   * Отдельно от `unlocksOn`, потому что ответ «что делать» другой. Назвать
   * здесь тариф значило бы написать «starter and up» тому, у кого в шапке
   * формы и так starter: до первой оплаты план записан, но не оплачен.
   */
  needsPlan?: true;
}

export interface CapacityOptions {
  plan: PlanId;
  cadences: CapacityOption<Cadence>[];
  assistants: AssistantOption[];
  defaultAssistants: readonly Platform[];
  promptsPerClient: number | null;
  monthlyCheckAllowance: number;
  estimatedCostPerAnswerUsd: number;
}

/**
 * Что показать в форме расписания.
 *
 * Ассистенты пересекаются с каталогом: тариф может разрешать платформу, по
 * которой адаптера ещё нет, и предлагать её галочкой нельзя — по ней не будет
 * ни одного ответа. Сегодня пересечение совпадает с `PLATFORMS`.
 */
/**
 * Самый дешёвый тариф, на котором ассистент включается.
 *
 * `null` — не включается нигде: такого сегодня нет, но молча показать
 * «доступно на» несуществующем тарифе было бы хуже, чем не показать.
 */
function cheapestPlanWith(
  assistant: Platform,
  capabilitiesOf: CapabilitiesLookup,
): PlanId | null {
  const order: PlanId[] = ["starter", "growth", "scale"];
  return order.find((plan) => capabilitiesOf(plan).assistants.includes(assistant)) ?? null;
}

/** Подменяется в тестах: разведение тарифов надо проверять до того, как оно случится. */
export type CapabilitiesLookup = (plan: PlanId) => MeasurementCapabilities;

export function capacityOptions(
  plan: PlanId,
  capabilitiesOf: CapabilitiesLookup = capabilitiesFor,
  /**
   * Чем агентство располагает на самом деле. По умолчанию — всё, что даёт
   * тариф; до первой оплаты набор уже (бесплатный аудит без Grok).
   *
   * Отдельно от `capabilitiesOf`, потому что у них разные задачи: этот
   * говорит, что показать включённым сейчас, а тот ищет, на каком тарифе
   * недоступное включается. Сложи их в один — и ассистент, выключенный до
   * оплаты, остался бы без ответа «что сделать, чтобы появился».
   */
  capabilities: MeasurementCapabilities = capabilitiesOf(plan),
): CapacityOptions {

  return {
    plan,
    cadences: capabilities.cadences.map((cadence) => ({
      id: cadence,
      label: CADENCE_LABELS[cadence],
    })),
    /**
     * Все измеримые ассистенты, а не только разрешённые тарифом.
     *
     * Недоступного не должно не быть на экране — его должно быть видно
     * выключенным. Иначе агентство на младшем тарифе не узнаёт, что
     * ассистент вообще существует, а увидев потом у соседа, решает, что
     * продукт что-то скрывал. `unlocksOn` называет самый дешёвый тариф,
     * на котором он включается, — чтобы отказ был с ответом «что делать»,
     * а не просто серой галочкой.
     */
    assistants: PLATFORM_IDS.filter((id) =>
      ASSISTANTS.some((assistant) => assistant.id === id && assistant.measurable),
    ).map((id) => {
      const allowed = capabilities.assistants.includes(id);
      // Тариф его даёт — значит заперт он не тарифом, а тем, что за тариф
      // ещё не заплатили. Это разные отказы и разные подсказки.
      const needsPlan = !allowed && capabilitiesOf(plan).assistants.includes(id);
      const unlocksOn = allowed || needsPlan ? null : cheapestPlanWith(id, capabilitiesOf);

      return {
        id,
        label: assistantLabel(id),
        allowed,
        ...(unlocksOn ? { unlocksOn } : {}),
        ...(needsPlan ? { needsPlan: true as const } : {}),
      };
    }),
    defaultAssistants: capabilities.defaultAssistants,
    promptsPerClient: capabilities.promptsPerClient,
    monthlyCheckAllowance: monthlyCheckAllowance(plan),
    estimatedCostPerAnswerUsd: ESTIMATED_COST_PER_ANSWER_USD,
  };
}

/**
 * Подписи ассистентов, которых тариф включает новому клиенту.
 *
 * Нужна витрине: с тех пор как тарифы развели, называть тройку литералом
 * на странице нельзя — на младшем тарифе она другая, и страница начала бы
 * обещать то, чего агентство не получит. Здесь один источник и для
 * конфига, и для текста.
 */
export function defaultAssistantLabels(plan: PlanId): string[] {
  return capabilitiesFor(plan).defaultAssistants.map(assistantLabel);
}

/** Все ассистенты, которых тариф вообще позволяет включить, — для карточки тарифа. */
export function allowedAssistantLabels(plan: PlanId): string[] {
  return capabilitiesFor(plan).assistants.map(assistantLabel);
}

/**
 * Подписи ассистентов бесплатного аудита — через запятую и «and».
 *
 * Отдельно от `defaultAssistantSentence`, потому что до первой оплаты набор
 * другой: Grok туда не входит по цене. Витрина обещает именно бесплатный
 * аудит, и назвать там тройку тарифа значило бы пообещать ассистента,
 * которого человек не получит.
 */
export function freeAuditAssistantSentence(): string {
  return listed(FREE_AUDIT_ASSISTANTS.map(assistantLabel));
}

/** Те же подписи через запятую и «and» перед последней — для предложения. */
export function defaultAssistantSentence(plan: PlanId): string {
  return listed(defaultAssistantLabels(plan));
}
