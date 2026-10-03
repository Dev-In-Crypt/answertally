import { describe, expect, it } from "vitest";
import { ANSWER_PRICES } from "../adapters/pricing";
import { PLAN_LIMITS } from "../billing/period";
import { FREE_CHECK_ALLOWANCE } from "../billing/entitlements";
import { DEFAULT_GENERATED_PROMPT_COUNT } from "../prompts/generate";
import { MIN_SAMPLES_PER_CELL } from "../metrics/visibility";
import type { PlanId } from "../billing/entitlements";
import {
  FREE_AUDIT_ASSISTANTS,
  capabilitiesFor,
  capabilitiesForAgency,
  platformsForRun,
} from "./measurement";
import {
  defaultAssistantSentence,
  freeAuditAssistantSentence,
} from "../adapters/capacity";

/**
 * Что продукт спрашивает до первой оплаты.
 *
 * Бесплатный аудит — единственный расход без верхней границы: аккаунт
 * заводится на любой адрес, а лимит в 250 проверок считается на аккаунт.
 * Поэтому набор там уже, чем на самом младшем тарифе.
 */

const PLANS = Object.keys(PLAN_LIMITS) as PlanId[];

describe("capabilitiesForAgency", () => {
  it("плательщику даёт ровно то, что даёт его тариф", () => {
    for (const plan of PLANS) {
      expect(capabilitiesForAgency({ plan, paying: true })).toEqual(capabilitiesFor(plan));
    }
  });

  it("до первой оплаты набор уже и Grok в него не входит", () => {
    const free = capabilitiesForAgency({ plan: "starter", paying: false });

    expect(free.assistants).toEqual(FREE_AUDIT_ASSISTANTS);
    expect(free.assistants).not.toContain("grok");
    // Умолчание не может предлагать то, за что мы не готовы платить.
    expect(free.defaultAssistants).toEqual(free.assistants);
  });

  it("сужение не зависит от того, какой тариф записан у неплательщика", () => {
    /**
     * Подписки нет — тариф всегда starter по умолчанию. Но если он когда-то
     * окажется другим, набор обязан остаться бесплатным: платит или нет —
     * вот вопрос, на который здесь отвечают.
     */
    for (const plan of PLANS) {
      expect(capabilitiesForAgency({ plan, paying: false }).assistants).toEqual(
        FREE_AUDIT_ASSISTANTS,
      );
    }
  });

  it("бесплатный набор — подмножество младшего тарифа", () => {
    // Дать бесплатно больше, чем за деньги, значит сделать оплату бессмысленной.
    const starter = capabilitiesFor("starter").assistants;
    for (const id of FREE_AUDIT_ASSISTANTS) {
      expect(starter).toContain(id);
    }
  });
});

describe("почему набор именно такой", () => {
  it("каждый бесплатный ассистент дешевле любого исключённого", () => {
    /**
     * Список задан перечислением, а не отбором по цене: подешевей Grok
     * однажды — и бесплатный аудит изменился бы молча, хотя такого решения
     * никто не принимал.
     *
     * Но причина списка — цена, и она должна оставаться правдой. Этот тест
     * падает, когда разрыв исчезает, и зовёт пересмотреть список руками, а
     * не оставляет устаревшее решение жить само по себе.
     */
    const excluded = capabilitiesFor("starter").assistants.filter(
      (id) => !FREE_AUDIT_ASSISTANTS.includes(id),
    );

    expect(excluded.length).toBeGreaterThan(0);

    const dearestFree = Math.max(...FREE_AUDIT_ASSISTANTS.map((id) => ANSWER_PRICES[id].usd));
    const cheapestExcluded = Math.min(...excluded.map((id) => ANSWER_PRICES[id].usd));

    expect(dearestFree).toBeLessThan(cheapestExcluded);
  });

  it("исключение экономит заметно, а не копейки", () => {
    /**
     * Типовой аудит: 24 вопроса × 3 сэмпла. Если разница перестанет быть
     * кратной, ограничение не стоит того, что оно отнимает у витрины.
     */
    const rounds = 24 * 3;
    const cost = (ids: readonly string[]) =>
      rounds * ids.reduce((sum, id) => sum + ANSWER_PRICES[id as "grok"].usd, 0);

    const full = cost(capabilitiesFor("starter").assistants);
    const free = cost(FREE_AUDIT_ASSISTANTS);

    expect(free * 3).toBeLessThan(full);
  });
});

describe("как набор называется на витрине", () => {
  it("перечисляет по-английски, а не через запятую", () => {
    /**
     * «what ChatGPT, Perplexity say about it» — это уже не английский.
     * На трёх ассистентах запятая сходила с рук, на двух перестала.
     */
    expect(freeAuditAssistantSentence()).toBe("ChatGPT and Perplexity");
    expect(defaultAssistantSentence("starter")).toContain(" and ");
  });

  it("называет именно бесплатный набор, а не тройку тарифа", () => {
    // Иначе страница обещает ассистента, которого человек не получит.
    expect(freeAuditAssistantSentence()).not.toContain("Grok");
    expect(defaultAssistantSentence("starter")).toContain("Grok");
  });
});

describe("лимит бесплатного аудита", () => {
  /** Во что обходится аудит на наборе вопросов по умолчанию. */
  const DEFAULT_AUDIT =
    DEFAULT_GENERATED_PROMPT_COUNT * MIN_SAMPLES_PER_CELL * FREE_AUDIT_ASSISTANTS.length;

  it("покрывает один аудит целиком", () => {
    /**
     * Прогон начинается целиком или не начинается вовсе. Лимит ниже одного
     * аудита означает отказ на первом же экране нового агентства — и узнали
     * бы мы об этом не отсюда, а от человека, который ушёл.
     *
     * Множители взяты из тех же мест, что и поведение: набор ассистентов
     * бесплатного аудита уже менялся, и в тот день это соотношение
     * поехало молча.
     */
    expect(FREE_CHECK_ALLOWANCE).toBeGreaterThanOrEqual(DEFAULT_AUDIT);
  });

  it("не покрывает второй такой аудит", () => {
    // Витрина обещает «one full audit on one brand». Два — это не щедрость,
    // а расхождение обещания с поведением, и появилось оно однажды само.
    expect(FREE_CHECK_ALLOWANCE).toBeLessThan(DEFAULT_AUDIT * 2);
  });
});

describe("platformsForRun — кого спросит прогон", () => {
  const free = capabilitiesForAgency({ plan: "starter", paying: false });
  const starter = capabilitiesForAgency({ plan: "starter", paying: true });
  const scale = capabilitiesForAgency({ plan: "scale", paying: true });

  it("без расписания берёт умолчание того, что агентству положено", () => {
    expect(platformsForRun(free, null)).toEqual([...FREE_AUDIT_ASSISTANTS]);
    expect(platformsForRun(starter, undefined)).toEqual([...starter.defaultAssistants]);
  });

  it("из расписания выбрасывает то, чего бесплатному аудиту не положено", () => {
    // Ровно та ошибка: расписание с Grok у неплатящего.
    expect(platformsForRun(free, ["chatgpt", "perplexity", "grok"])).toEqual([
      "chatgpt",
      "perplexity",
    ]);
  });

  it("из расписания выбрасывает то, чего не даёт тариф", () => {
    expect(platformsForRun(starter, ["chatgpt", "claude"])).toEqual(["chatgpt"]);
    expect(platformsForRun(scale, ["chatgpt", "claude"])).toEqual(["chatgpt", "claude"]);
  });

  it("из расписания выбрасывает платформу, которую перестали измерять", () => {
    // Gemini остался в enum базы, но не спрашивается ни на одном тарифе.
    expect(platformsForRun(scale, ["chatgpt", "gemini"])).toEqual(["chatgpt"]);
  });

  it("сохраняет порядок расписания и не добавляет от себя", () => {
    expect(platformsForRun(scale, ["grok", "chatgpt"])).toEqual(["grok", "chatgpt"]);
    // Пустое расписание — пустой прогон, а не подмена умолчанием.
    expect(platformsForRun(scale, [])).toEqual([]);
  });
});
