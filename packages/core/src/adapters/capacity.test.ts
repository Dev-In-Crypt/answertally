import { describe, expect, it } from "vitest";
import {
  CADENCE_LABELS,
  capacityOptions,
  type CapabilitiesLookup,
  estimateSchedule,
  isCadence,
  refuseSchedule,
  refuseScheduleForPlan,
} from "./capacity";
import { ASSISTANTS } from "./catalogue";
import { DEFAULT_PLATFORMS, PLATFORM_IDS, type Platform } from "./types";
import { ANSWER_PRICES } from "./pricing";
import { ESTIMATED_COST_PER_ANSWER_USD, PLAN_LIMITS } from "../billing/period";
import {
  CADENCES,
  capabilitiesFor,
  monthlyAnswers,
  PROMPTS_PER_CLIENT,
  type Cadence,
  type MeasurementCapabilities,
} from "../config/measurement";
import type { PlanId } from "../billing/entitlements";

/**
 * Два разных утверждения, и их нельзя путать.
 *
 * 1. Сегодняшнее поведение не изменилось: конфиг разрешает всё, и ни один
 *    тариф ничего не отвергает. Это защита от «незаметно ограничили продукт».
 * 2. Ограничение работает, если его задать. Проверяется на выдуманных
 *    возможностях, передаваемых в чистую функцию, — умолчания при этом
 *    остаются нетронутыми (их менять нельзя без решения фаундера).
 */

const PLANS = Object.keys(PLAN_LIMITS) as PlanId[];

describe("сегодняшняя политика тарифов", () => {
  const STARTER_THREE = ["chatgpt", "perplexity", "grok"] as const;

  it.each(PLANS)("тариф %s разрешает опрос раз в две недели и раз в неделю", (plan) => {
    for (const cadence of ["biweekly", "weekly"] as const) {
      expect(refuseScheduleForPlan(plan, { cadence, assistants: STARTER_THREE })).toBeNull();
    }
  });

  it("ежедневный опрос доступен только на scale", () => {
    // Частота — самый сильный рычаг расхода: ×2 при недельном, ×14 при
    // ежедневном. Единственная опасная клетка модели себестоимости
    // создаётся именно им.
    expect(
      refuseScheduleForPlan("scale", { cadence: "daily", assistants: STARTER_THREE }),
    ).toBeNull();

    for (const plan of ["starter", "growth"] as const) {
      const refusal = refuseScheduleForPlan(plan, {
        cadence: "daily",
        assistants: STARTER_THREE,
      });

      expect(refusal?.code, `${plan} не должен давать ежедневный опрос`).toBe("cadence");
      // Отказ называет, что доступно взамен.
      expect(refusal?.message).toContain("every two weeks");
    }
  });

  it.each(PLANS)("у тарифа %s есть потолок вопросов на клиента", (plan) => {
    // Без потолка одна загрузка CSV добавляла десятки тысяч вопросов.
    expect(capabilitiesFor(plan).promptsPerClient).toBe(PROMPTS_PER_CLIENT);
  });

  it("умолчание частоты осталось biweekly", () => {
    // Каденс — самый сильный рычаг расхода (×14 при daily). Менять его
    // умолчание можно только решением фаундера.
    expect(CADENCES[0]).toBe("biweekly");
  });

  it("starter даёт три самых дешёвых ассистента", () => {
    // Разброс цены ответа между самым дешёвым и самым дорогим почти
    // пятикратный, и на младшем тарифе он съедал бы маржу быстрее всего.
    // С 07.10.2026 к тройке добавлены поверхности Google — дешёвые, через поставщика выдачи.
    expect(capabilitiesFor("starter").assistants).toEqual([...STARTER_THREE, "ai-overviews", "ai-mode"]);
    expect(
      refuseScheduleForPlan("starter", { cadence: "biweekly", assistants: STARTER_THREE }),
    ).toBeNull();
  });

  it("starter отказывает в дорогом ассистенте и называет его", () => {
    const refusal = refuseScheduleForPlan("starter", {
      cadence: "biweekly",
      assistants: ["claude"],
    });

    expect(refusal?.code).toBe("assistant");
    // В отказе названы и запертый, и то, что взамен доступно.
    expect(refusal?.message).toContain("Claude");
    expect(refusal?.message).toContain("ChatGPT");
  });

  it("неизмеряемого ассистента не даёт ни один тариф", () => {
    // Запрет условий поставщика — не то же, что «дорого для младшего
    // тарифа»: Gemini не открывается переходом на старший.
    for (const plan of PLANS) {
      expect(
        refuseScheduleForPlan(plan, { cadence: "biweekly", assistants: ["gemini"] })?.code,
      ).toBe("assistant");
    }
  });

  it.each(["growth", "scale"] as const)("тариф %s даёт всех измеряемых", (plan) => {
    expect(
      refuseScheduleForPlan(plan, {
        cadence: "biweekly",
        assistants: capabilitiesFor(plan).assistants,
      }),
    ).toBeNull();
  });

  it("умолчание каждого тарифа помещается в то, что он разрешает", () => {
    // Иначе новый клиент заводился бы с ассистентом, которого тариф не
    // даёт, и первое же сохранение расписания упиралось бы в отказ.
    for (const plan of PLANS) {
      const { assistants, defaultAssistants } = capabilitiesFor(plan);
      for (const id of defaultAssistants) {
        expect(assistants, `${plan}: умолчание вне разрешённого`).toContain(id);
      }
    }
  });

  it("на growth и scale умолчание прежнее", () => {
    for (const plan of ["growth", "scale"] as const) {
      expect(capacityOptions(plan).defaultAssistants).toEqual(DEFAULT_PLATFORMS);
    }
  });
});

describe("ограничение работает, если его задать", () => {
  const weeklyOnly: MeasurementCapabilities = {
    promptsPerClient: 24,
    cadences: ["biweekly", "weekly"],
    assistants: ["chatgpt", "perplexity"],
    defaultAssistants: ["chatgpt"],
  };

  it("запрещённая частота отвергается с названием разрешённых", () => {
    const refusal = refuseSchedule(weeklyOnly, {
      cadence: "daily",
      assistants: ["chatgpt"],
    });

    expect(refusal?.code).toBe("cadence");
    expect(refusal?.message).toContain("Daily");
    expect(refusal?.message).toContain("weekly");
  });

  it("разрешённая частота проходит", () => {
    expect(refuseSchedule(weeklyOnly, { cadence: "weekly", assistants: ["chatgpt"] })).toBeNull();
  });

  it("запрещённый ассистент отвергается и назван по имени", () => {
    const refusal = refuseSchedule(weeklyOnly, {
      cadence: "weekly",
      assistants: ["chatgpt", "gemini"],
    });

    expect(refusal?.code).toBe("assistant");
    expect(refusal?.message).toContain("Gemini");
    expect(refusal?.message).not.toContain("ChatGPT is not");
  });

  it("несколько запрещённых ассистентов перечисляются вместе", () => {
    const refusal = refuseSchedule(weeklyOnly, {
      cadence: "weekly",
      assistants: ["gemini", "claude"],
    });

    expect(refusal?.code).toBe("assistant");
    expect(refusal?.message).toContain("Gemini");
    expect(refusal?.message).toContain("Claude");
    expect(refusal?.message).toContain("are not part of this plan");
  });

  it("потолок промптов срабатывает только при превышении", () => {
    const within = refuseSchedule(weeklyOnly, {
      cadence: "weekly",
      assistants: ["chatgpt"],
      promptCount: 24,
    });
    const over = refuseSchedule(weeklyOnly, {
      cadence: "weekly",
      assistants: ["chatgpt"],
      promptCount: 25,
    });

    expect(within).toBeNull();
    expect(over?.code).toBe("prompt-cap");
    expect(over?.message).toContain("24");
    expect(over?.message).toContain("25");
  });

  it("частота проверяется раньше ассистентов: одна причина за раз", () => {
    const refusal = refuseSchedule(weeklyOnly, {
      cadence: "daily",
      assistants: ["gemini"],
    });

    expect(refusal?.code).toBe("cadence");
  });

  it("форма предлагает ровно то, что разрешено", () => {
    // Через тот же чистый путь, что и `capacityOptions`, но на урезанных
    // возможностях: сам `capacityOptions` ходит в конфиг, менять который нельзя.
    expect(weeklyOnly.cadences.map((c) => CADENCE_LABELS[c])).toEqual([
      "Every two weeks",
      "Weekly",
    ]);
  });
});

describe("что предлагается в форме", () => {
  it.each(PLANS)("тариф %s предлагает только измеряемых ассистентов", (plan) => {
    const options = capacityOptions(plan);

    const offered = options.assistants.map((a) => a.id);

    // Список берётся из каталога, а не вписан: платформа, которую перестали
    // измерять, обязана исчезнуть из формы сама.
    expect(offered).toEqual(
      ASSISTANTS.filter((a) => a.measurable && PLATFORM_IDS.includes(a.id as never)).map(
        (a) => a.id,
      ),
    );
    // Неизмеряемым в расписании места нет — ни тем, у кого нет API, ни
    // Gemini, которого запрещают условия поставщика.
    for (const id of ["copilot", "gemini"]) {
      expect(offered).not.toContain(id);
    }
  });

  it.each(PLANS)("тариф %s отдаёт свой месячный лимит проверок", (plan) => {
    expect(capacityOptions(plan).monthlyCheckAllowance).toBe(PLAN_LIMITS[plan].aiCheckAllowance);
  });

  it("цена ответа берётся из единственной константы в коде", () => {
    expect(capacityOptions("growth").estimatedCostPerAnswerUsd).toBe(
      ESTIMATED_COST_PER_ANSWER_USD,
    );
  });

  it("частоты идут от редкой к частой: первая — умолчание", () => {
    // Порядок важен: первая в списке становится выбранной в форме, и это
    // должен быть самый дешёвый вариант, а не самый частый.
    expect(capacityOptions("scale").cadences.map((c) => c.id)).toEqual([
      "biweekly",
      "weekly",
      "daily",
    ]);
    expect(capacityOptions("starter").cadences.map((c) => c.id)).toEqual(["biweekly", "weekly"]);
  });
});

describe("оценка расхода", () => {
  /**
   * Та самая тройка, которой продукт меряет по умолчанию, а не выдуманная.
   *
   * Здесь стоял набор с Gemini — он пережил решение перестать его измерять,
   * и «запускная тройка» в тесте перестала быть запускной тройкой. Берём
   * набор оттуда же, откуда его берёт продукт.
   */
  // Прежняя запускная тройка: тест про цену набора с дорогим Grok.
  const TRIO: Platform[] = ["chatgpt", "perplexity", "grok"];
  const setting = { prompts: 24, assistants: TRIO, samplesPerPrompt: 3 };

  it("ответов в месяц — ровно столько, сколько считает конфиг", () => {
    for (const cadence of CADENCES) {
      const estimate = estimateSchedule({ plan: "growth", cadence, ...setting });
      expect(estimate.answersPerMonth).toBe(
        monthlyAnswers({ ...setting, assistants: TRIO.length, cadence }),
      );
    }
  });

  it("частота — главный рычаг: недельная вдвое дороже, дневная на порядок", () => {
    const biweekly = estimateSchedule({ plan: "growth", cadence: "biweekly", ...setting });
    const weekly = estimateSchedule({ plan: "growth", cadence: "weekly", ...setting });
    const daily = estimateSchedule({ plan: "growth", cadence: "daily", ...setting });

    expect(weekly.answersPerMonth / biweekly.answersPerMonth).toBeCloseTo(2, 1);
    expect(daily.answersPerMonth / weekly.answersPerMonth).toBeCloseTo(6.9, 1);
  });

  it("расход считается по цене каждого ассистента, а не по одной на всех", () => {
    const estimate = estimateSchedule({ plan: "growth", cadence: "weekly", ...setting });
    const each = estimate.answersPerMonth / TRIO.length;

    expect(estimate.estimatedCostUsd).toBeCloseTo(
      TRIO.reduce((sum, id) => sum + ANSWER_PRICES[id].usd * each, 0),
      6,
    );
  });

  it("два набора одного размера стоят по-разному", () => {
    // Ровно та ошибка, которая здесь была: цена зависела только от количества.
    const cheap = estimateSchedule({
      plan: "growth",
      cadence: "weekly",
      prompts: 24,
      assistants: ["perplexity", "chatgpt"],
      samplesPerPrompt: 3,
    });
    const dear = estimateSchedule({
      plan: "growth",
      cadence: "weekly",
      prompts: 24,
      // Grok, а не Gemini: живая проверка 2026-09-29 показала, что дороже
      // всех именно он. Пара подобрана по сегодняшним ценам, иначе тест
      // утверждал бы обратное тому, что есть.
      assistants: ["grok", "claude"],
      samplesPerPrompt: 3,
    });

    expect(dear.answersPerMonth).toBe(cheap.answersPerMonth);
    expect(dear.estimatedCostUsd).toBeGreaterThan(cheap.estimatedCostUsd * 3);
  });

  it("прежняя оценка по цене ChatGPT занижала расход запускной тройки", () => {
    const estimate = estimateSchedule({ plan: "growth", cadence: "weekly", ...setting });
    const old = estimate.answersPerMonth * ESTIMATED_COST_PER_ANSWER_USD;

    expect(old).toBeLessThan(estimate.estimatedCostUsd);
    expect(estimate.estimatedCostUsd / old).toBeGreaterThan(1.15);
  });

  it("обычная настройка укладывается в лимит любого тарифа", () => {
    for (const plan of PLANS) {
      const estimate = estimateSchedule({ plan, cadence: "weekly", ...setting });
      expect(estimate.overAllowance).toBe(false);
      expect(estimate.ratio).toBeLessThan(1);
    }
  });

  it("перерасход виден до сохранения, а не после", () => {
    const estimate = estimateSchedule({
      plan: "starter",
      prompts: 60,
      assistants: PLATFORM_IDS,
      samplesPerPrompt: 5,
      cadence: "daily",
    });

    // 60 вопросов × 7 платформ × 5 выборок × 30 дней.
    expect(estimate.answersPerMonth).toBe(63_000);
    expect(estimate.allowance).toBe(PLAN_LIMITS.starter.aiCheckAllowance);
    expect(estimate.overAllowance).toBe(true);
    expect(estimate.ratio).toBeGreaterThan(1);
  });

  it("пустая настройка не делит на ноль", () => {
    const estimate = estimateSchedule({
      plan: "starter",
      prompts: 0,
      assistants: [],
      samplesPerPrompt: 3,
      cadence: "weekly",
    });

    expect(estimate.answersPerMonth).toBe(0);
    expect(estimate.estimatedCostUsd).toBe(0);
    expect(estimate.overAllowance).toBe(false);
  });
});

describe("разбор частоты", () => {
  it.each([...CADENCES])("%s — известная частота", (cadence) => {
    expect(isCadence(cadence)).toBe(true);
  });

  it.each(["hourly", "monthly", "", "BIWEEKLY"])("%s — нет", (value) => {
    expect(isCadence(value)).toBe(false);
  });

  it("у каждой известной частоты есть подпись", () => {
    for (const cadence of CADENCES) {
      expect(CADENCE_LABELS[cadence as Cadence]).toBeTruthy();
    }
  });
});

describe("ассистенты в форме расписания", () => {
  it("показываются все измеримые, а не только разрешённые тарифом", () => {
    // Спрятанный ассистент — это ассистент, о котором агентство не узнает.
    const ids = capacityOptions("starter").assistants.map((a) => a.id);

    for (const id of ["chatgpt", "perplexity", "claude", "grok"]) {
      expect(ids).toContain(id);
    }
  });

  it("неизмеримая поверхность в список не попадает", () => {
    // По ней нет адаптера: галочка обещала бы измерение, которого не будет.
    const ids = capacityOptions("scale").assistants.map((a) => a.id);
    expect(ids).not.toContain("copilot");
    // Gemini перестал измеряться — из формы он обязан исчезнуть так же,
    // как поверхность без API: галочка обещала бы то, чего не будет.
    expect(ids).not.toContain("gemini");
  });

  it("на starter дорогой виден, но заперт и подписан тарифом", () => {
    const assistants = capacityOptions("starter").assistants;

    const locked = assistants.find((a) => a.id === "claude");
    expect(locked?.allowed).toBe(false);
    expect(locked?.unlocksOn).toBe("growth");

    for (const id of ["chatgpt", "perplexity", "grok"] as const) {
      expect(assistants.find((a) => a.id === id)?.allowed).toBe(true);
    }
  });

  it("на growth и scale запертых нет", () => {
    for (const plan of ["growth", "scale"] as const) {
      for (const assistant of capacityOptions(plan).assistants) {
        expect(assistant.allowed).toBe(true);
        expect(assistant.unlocksOn).toBeUndefined();
      }
    }
  });

  it("запертый называет тариф, на котором включается", () => {
    // Проверка на подменённом конфиге: сегодня тарифы не разведены, но
    // рычаг обязан работать в тот день, когда их разведут — иначе на
    // экране появится серая галочка без объяснения.
    const restricted: CapabilitiesLookup = (plan) =>
      plan === "starter"
        ? { ...capabilitiesFor(plan), assistants: ["chatgpt", "perplexity", "grok"] }
        : capabilitiesFor(plan);

    const assistants = capacityOptions("starter", restricted).assistants;
    const claude = assistants.find((a) => a.id === "claude");
    const chatgpt = assistants.find((a) => a.id === "chatgpt");

    // Запертый виден, выключен и подписан самым дешёвым подходящим тарифом.
    expect(claude?.allowed).toBe(false);
    expect(claude?.unlocksOn).toBe("growth");
    // Разрешённый подписи не несёт: «доступно на starter» на starter — шум.
    expect(chatgpt?.allowed).toBe(true);
    expect(chatgpt?.unlocksOn).toBeUndefined();
  });
});
