/**
 * Формулировки, которые видит агентство и его клиент.
 *
 * Инвариант 2 (CLAUDE.md): слова, заявляющие доказанную причинность, запрещены —
 * их точный список и машинная проверка живут в copy.honesty.test.ts.
 *
 * Разрешены «estimated», «confidence», «evidence». Причина не в юридической
 * осторожности: спек прямо запрещает изображать причинность, которой нет —
 * измерить её на одном клиенте невозможно, а обещание, которое нельзя сдержать,
 * стоит агентству отношений с его собственным клиентом.
 *
 * Все такие строки живут здесь, а не в компонентах, чтобы их можно было
 * проверить одним grep-тестом (T46).
 */

import type { AssistantSetComparison } from "./metrics/comparability";

export const CONFIDENCE_LABELS = {
  low: "Confidence: low",
  medium: "Confidence: medium",
  high: "Confidence: high",
} as const;

export const MEASUREMENT_COPY = {
  /** Показывается рядом с любой цифрой, посчитанной по недобору сэмплов. */
  insufficientSamples:
    "Fewer answers than the minimum for this window. Treat the number as indicative, not as a measurement.",
  /** Пояснение, как считается видимость. */
  visibilityBasis:
    "Share of answers in the period mentioning the brand, across every sample taken. Never a single answer.",
  noDataYet: "No measurements yet",
  /** Шапка экрана клиента: чем являются все цифры на нём. */
  methodNote:
    "Everything on this screen is estimated from repeated samples of assistant answers. No figure comes from a single answer, and nothing is published anywhere until you approve it.",
  /** Основание матрицы «промпт × ассистент». */
  matrixBasis:
    "Share of sampled answers mentioning the brand. Every cell is an aggregate over the window, never one answer.",
  /**
   * Ассистент, которого мы не спрашиваем. Формулировка обязана отличать
   * «не спрашивали» от «спросили и не нашли» — второе было бы неправдой.
   */
  notMeasured:
    "Not measured yet: we do not ask this assistant, so there is nothing to report either way.",
  /** Ячейка, где конкурента назвали, а клиента нет. */
  competitorOnly: "A tracked competitor was named in answers where the client was not.",
  /** Ячейка ниже порога сэмплов. */
  underFloor: "Under the sample floor for this window, so it shows a dash rather than a guess.",
  /**
   * Изменение, которое выборка не различает. Формулировка обязана говорить
   * про предел выборки, а не про отсутствие изменения: это разные вещи.
   */
  withinNoise: "within what this sample size can tell apart",
  /**
   * Предел метрики переходов. Стоит рядом с цифрой, а не в сноске: без этой
   * фразы её прочитают как полный счёт визитов из ассистентов.
   */
  trafficUndercount:
    "Referred sessions are undercounted: in-app browsers drop the source, and many people type the brand instead of clicking. Read this beside visibility, not as its result.",
  /**
   * Видимость и переходы стоят рядом — и это всё, что о них можно сказать.
   * «Выросло вместе» и «одно вызвало другое» — разные утверждения, и второе
   * на этих данных не проверяется никак.
   */
  observedTogether:
    "Observed during the same period. Shown side by side because both moved, not because one produced the other.",
  /**
   * Состав измеренных ассистентов между периодами изменился.
   *
   * Стоит рядом с числом, а не в сноске: доля считается от тех ответов, что
   * есть, и включённый или выключенный ассистент двигает её сам по себе.
   */
  assistantSetChanged:
    "The set of assistants measured changed between these periods, so the two figures do not rest on the same answers.",
  /** По какому набору посчитано изменение; %ASSISTANTS% подставляется. */
  assistantSetComparedOn:
    "Change worked out over %ASSISTANTS%, the assistants measured in both periods.",
  /** Общих ассистентов нет вовсе. */
  assistantSetDisjoint:
    "No assistant was measured in both periods, so there is no like-for-like change to show.",
  /** Нет записи о том, что мерялось в одном из периодов. */
  assistantSetUnknown:
    "There is no record of which assistants were measured in one of these periods, so the change is left out.",
  /**
   * Ассистент остался в расписании, но тариф его больше не даёт.
   *
   * Так бывает после перехода на младший тариф: расписание переживает смену
   * плана, потому что строку с ним никто не переписывает. Раньше форма
   * показывала его обычной галочкой, и человек узнавал о проблеме только
   * когда нажимал «сохранить» и получал отказ, — а прогоны всё это время
   * продолжали его спрашивать за наш счёт.
   */
  assistantOutsidePlan:
    "Not included in your plan any more, so it is no longer measured. Remove it to save the schedule, or move to a plan that covers it.",
  /** Почему в разделе движения не все вопросы. */
  movementBasis:
    "Only questions where the change is larger than this sample size can explain on its own. Anything smaller is left out rather than shown as a result.",
} as const;

export const DIAGNOSIS_COPY = {
  /** Основной вывод: разрыв создаётся сторонними источниками. */
  thirdPartyGap:
    "The gap is driven by third-party sources rather than by a shortage of owned content.",
  /** Основной вывод: разрыв на собственных страницах. */
  ownedGap:
    "Models mostly cite owned pages here, so the gap points at the client's own content rather than at outside sources.",
  /** Данных не хватает для вывода. */
  inconclusive:
    "Not enough cited sources yet to say where the gap comes from. More runs will make this readable.",
  /** Приписка к любому выводу. */
  evidenceNote: "Based on the sources models actually cited in the measured period.",
  /**
   * Предел вывода о присутствии. Мы не открываем саму страницу — мы видим, что
   * источник процитирован, и упомянут ли бренд в том же ответе. Без этой
   * оговорки «клиента нет на g2.com» читается как проверенный факт о странице.
   */
  presenceCaveat:
    "Presence is inferred from answers where the source was cited, not from checking the page itself.",
} as const;

export const REPORT_COPY = {
  /**
   * Идёт в каждый отчёт: клиент должен понимать, что именно измерено.
   *
   * Формулировка на несколько платформ — только для случая, когда их
   * действительно было несколько. Собирать её надо через
   * `measurementBasisFor`, а не брать константу наугад: отчёт по одной
   * платформе, утверждающий «several platforms», — ровно то ложное
   * утверждение, ради запрета которого существует инвариант 2.
   */
  measurementBasis:
    "Visibility is the share of AI answers mentioning the brand, measured across repeated samples on several platforms and grouped by week.",
  /** Тот же смысл, но для одной платформы; %PLATFORM% подставляется. */
  measurementBasisSinglePlatform:
    "Visibility is the share of %PLATFORM% answers mentioning the brand, measured across repeated samples and grouped by week. Other assistants were not measured for this report.",
  /** Ставится, когда движение нельзя отделить от общего дрейфа платформ. */
  noComparisonGroup:
    "There were no untouched topics to compare against in this period, so movement cannot be separated from platform-wide changes.",
  /** Ставится при коротком периоде наблюдения. */
  shortPeriod:
    "Assistants' search results and cited sources typically take weeks to shift, so a short period shows early signal rather than settled results.",
  /** Идёт в каждый аудит: снимок «как сейчас», а не прогноз. */
  opportunityBasis:
    "This audit is a single measurement of how assistants answer today. The ranked work is what the current sources suggest, with expected effort, not a forecast of results.",
  /**
   * Состав ассистентов менялся внутри периода отчёта.
   *
   * Клиент читает «было → стало» как одно измерение в двух точках. Если
   * точки стоят на разных наборах ответов, это не одно измерение, и сказать
   * об этом надо там же, где числа, — %ASSISTANTS% подставляется.
   */
  assistantSetChanged:
    "The set of assistants measured changed during this period. The figures here are worked out over %ASSISTANTS%, measured throughout, so both ends of the period can be read side by side.",
  /** Общего ассистента на весь период не нашлось. */
  assistantSetNoOverlap:
    "No assistant was measured across the whole period. Each end is shown on its own, and no change between them is given.",
  /** Оговорка к предложенному объёму работ и деньгам. */
  scopeEstimate:
    "Retainer and effort are the agency's own estimates for the proposed scope, shown so the numbers behind the proposal are visible.",
} as const;

/**
 * Имена платформ для подписей.
 *
 * Шире каталога ассистентов намеренно. Каталог отвечает на вопрос «что мы
 * измеряем», а подпись нужна и тому, что мы не измеряем: в записанных
 * ответах и в переходах с сайта ассистента встречаются платформы, которых
 * в каталоге нет. Без имени они показываются как `gemini` строчными.
 */
const PLATFORM_LABELS: Record<string, string> = {
  chatgpt: "ChatGPT",
  perplexity: "Perplexity",
  gemini: "Gemini",
  claude: "Claude",
  grok: "Grok",
};

/** Имя платформы; неизвестная возвращается как есть, а не пустой строкой. */
export function platformLabel(id: string): string {
  return PLATFORM_LABELS[id] ?? id;
}

/**
 * Оговорка о природе измерения, собранная по факту.
 *
 * Пустой список платформ — тоже случай «нескольких»: он означает, что срезов
 * ещё нет, и обещать конкретную платформу не на чем.
 */
export function measurementBasisFor(platforms: readonly string[]): string {
  const unique = [...new Set(platforms)];
  if (unique.length !== 1) {
    return REPORT_COPY.measurementBasis;
  }

  const platform = unique[0] as string;
  return REPORT_COPY.measurementBasisSinglePlatform.replace(
    "%PLATFORM%",
    PLATFORM_LABELS[platform] ?? platform,
  );
}

/** Названия ассистентов через запятую, как их читает человек. */
function assistantList(ids: readonly string[]): string {
  const labels = ids.map((id) => PLATFORM_LABELS[id] ?? id);
  if (labels.length <= 1) return labels[0] ?? "";
  return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`;
}

/**
 * Приписка к изменению — по факту того, что сравнивалось.
 *
 * `null`, когда состав не менялся: заметка про неизменившийся набор — это
 * шум, а шум приучает не читать заметки там, где они важны.
 */
export function assistantBasisNote(comparison: AssistantSetComparison): string | null {
  switch (comparison.verdict) {
    case "same":
      return null;
    case "unknown":
      // Прошлого окна нет вовсе — это первый замер, а не потерянная запись,
      // и оговорка про «нет записи» его только путает.
      return comparison.previous.length === 0 && comparison.current.length > 0
        ? null
        : MEASUREMENT_COPY.assistantSetUnknown;
    case "disjoint":
      return MEASUREMENT_COPY.assistantSetDisjoint;
    default:
      return `${MEASUREMENT_COPY.assistantSetChanged} ${MEASUREMENT_COPY.assistantSetComparedOn.replace(
        "%ASSISTANTS%",
        assistantList(comparison.shared),
      )}`;
  }
}

/**
 * Та же мысль для клиентского отчёта — длиннее и без жаргона.
 *
 * Идёт в `caveats`, то есть в отдельный раздел отчёта, а не в подпись под
 * числом: клиент подписывает отчёт именем, и основание сравнения он должен
 * увидеть там же, где всё остальное, чего мы не скрываем.
 */
export function reportAssistantBasisFor(comparison: AssistantSetComparison): string | null {
  switch (comparison.verdict) {
    case "same":
      return null;
    case "unknown":
    case "disjoint":
      return REPORT_COPY.assistantSetNoOverlap;
    default:
      return REPORT_COPY.assistantSetChanged.replace(
        "%ASSISTANTS%",
        assistantList(comparison.shared),
      );
  }
}

/**
 * Партнёрские условия словами.
 *
 * Числа в текст не вписаны — подставляются из `billing/partner.ts`, того же
 * места, откуда их берёт биллинг. Цена, набранная в тексте руками, однажды
 * разойдётся с той, по которой выставлен счёт, и разойдётся в сторону
 * агентства, которое уже согласилось на старую.
 */
export const PARTNER_COPY = {
  /** Почему условия вообще напечатаны. */
  published:
    "Both terms below are published in full, with the numbers. The rest of this category says “discounted licenses” and “flexible rate cards” and prints nothing, so you cannot compare anything until you are on a call.",
  /**
   * Оптовая цена: %THRESHOLD%, %PRICE%, %DISCOUNT% подставляются.
   *
   * «Past %THRESHOLD%», а не «с %THRESHOLD%-го»: двадцать пятый аккаунт
   * входит в тариф и стоит тарифных денег. Порядковое числительное здесь
   * сдвигало бы границу на один аккаунт в пользу читателя — а это цена,
   * напечатанная на сайте, и спорить о ней потом будет поздно.
   */
  volume:
    "Once you are past %THRESHOLD% client accounts, every further account is $%PRICE% a month, %DISCOUNT%% off the rate the top plan works out to. It applies only to the accounts above %THRESHOLD%, never to the ones the plan already covers, so adding a client never changes the price of your plan.",
  /** Почему скидка марджинальная, а не на всё сразу. */
  volumeShape:
    "We price it this way because the alternative has a cliff in it: if the discount applied to every account at once, your 26th client would cost us more than your 25th, and we would end up discouraging the thing we want.",
  /** Комиссия: %RATE%, %MONTHS% подставляются. */
  referral:
    "Introduce another agency and you get %RATE%% of what they pay for their first %MONTHS% months. It is paid on their actual invoices, it stops at %MONTHS% months, and it does not apply to your own accounts or to an agency already talking to us.",
  /** Как это администрируется на самом деле. */
  howItRuns:
    "Neither is self-serve yet. Both are agreed by email and applied to your account by hand, and the referral is tracked the same way. Saying that is more use to you than a dashboard we have not built.",
  /** Что программа не даёт — чтобы не додумывали. */
  notIncluded:
    "There is no exclusivity, no minimum commitment, no territory and no tier you have to qualify for. Nothing here changes what your clients see or who owns the relationship.",
} as const;

/** Подставляет числа партнёрских условий в их текст. */
export function partnerTerms(input: {
  threshold: number;
  accountPriceUsd: number;
  discountPct: number;
  referralPct: number;
  referralMonths: number;
}): { volume: string; referral: string } {
  return {
    volume: PARTNER_COPY.volume
      .replaceAll("%THRESHOLD%", String(input.threshold))
      .replace("%PRICE%", String(input.accountPriceUsd))
      .replace("%DISCOUNT%", String(input.discountPct)),
    referral: PARTNER_COPY.referral
      .replace("%RATE%", String(input.referralPct))
      .replaceAll("%MONTHS%", String(input.referralMonths)),
  };
}

export const OPPORTUNITY_COPY = {
  /** Что это за экран. Стоит над списком, а не в подсказке. */
  basis:
    "Each opportunity is derived from measured answers: where the client is losing, on which questions, and what the cited sources suggest doing about it. Ranked by an internal score, not by certainty of outcome.",
  /** Пояснение к оценке. Никакого обещания результата. */
  scoreBasis:
    "The score ranks work against work for this client. It is not a rating of the site and not a forecast. It combines how large the gap is, how much of the tracked question set it touches, how commercial those questions are, and how well it was measured.",
  /** Подписи множителей — ровно то, чем они являются. */
  factorLabels: {
    impact: "Size of the gap",
    coverage: "Share of tracked questions",
    commercialIntent: "Commercial intent",
    actionability: "How much of it you control",
    confidence: "How well it is measured",
  },
  /**
   * Coverage — доля отслеживаемых вопросов, а не частотность запросов.
   * Данных о спросе у продукта нет, и подпись обязана это показывать.
   */
  coverageBasis:
    "Share of the questions this client tracks, not search demand; the product does not measure how often people ask them.",
  /** Оговорка над примерами ответов в доказательстве. */
  evidenceBasis:
    "Examples from the sample, shown after the aggregate. A single answer is never a result on its own.",
  /** Окно, за которое посчитана возможность. */
  windowBasis: "Measured over the window shown; the score is fixed to that window, not to today.",
  /** Возможность больше не обнаруживается. */
  resolvedNote:
    "No longer detected in the latest measurement. This is a record of what changed, not attribution of cause.",
  /** Пустой экран. */
  emptyTitle: "No opportunities yet",
  emptyBody:
    "We need enough measured answers to tell a real gap from a small sample. Run a measurement and this fills in.",
  /** Отклонение обязано иметь причину — как и снятие задачи. */
  dismissRequiresReason: "Say why this is not worth doing, so the next person does not re-open it.",
  dismissReturns:
    "A dismissed opportunity comes back only if it grows noticeably larger than it was when you dismissed it.",
  /** Отложить — не то же самое, что отказаться: срок выйдет, и пункт вернётся. */
  snoozeLabel: "Not this month",
  snoozeNote:
    "Kept out of the list until the date passes, then shown again with whatever the measurements say by then.",
} as const;

/**
 * Утверждения об измерении на публичном сайте (/, /product, /pricing,
 * /free-audit). Сайт обещает от имени продукта, поэтому его фразы о том, что
 * и как измерено, живут здесь же и проверяются тем же grep-тестом, что и
 * фразы продукта. Где смысл совпадает с продуктом, сайт берёт константы выше.
 */
export const MARKETING_COPY = {
  /** Подвал каждой страницы сайта. */
  siteBasis:
    "Every figure on this site is estimated from repeated samples of assistant answers. Example agencies, clients, competitors and *.example domains are invented. ChatGPT, Perplexity, Grok and Claude are trademarks of their owners; Answertally is not affiliated with or endorsed by them.",
  /** Карточка «как сделана каждая цифра». */
  methodNote:
    "Everything is estimated from repeated samples of assistant answers. Nothing is published anywhere until you approve it.",
  /**
   * Главное обещание сайта (hero). Сказано «показываем диапазон и
   * доказательства», а не «точнее»: сэмплов у нас меньше, чем у ежедневных
   * трекеров, и сравнение по точности мы бы проиграли.
   */
  evidencePromise:
    "We show the range and the evidence behind every number: how many answers it rests on, how confident it is, and the answers themselves. No rank, and no single score.",
  /** Строка метода под hero. Каденс — по умолчанию продукта (раз в две недели). */
  methodLine:
    "No number from fewer than 3 answers per question per assistant · measured every two weeks by default · every raw answer kept",
  /** Порог сэмплов (контракт C3), сказанный одной фразой для сайта. */
  sampleFloor: "No figure from fewer than three answers per question per assistant.",
  /** Каденс по умолчанию: так выставлено в настройках расписания клиента. */
  cadence: "Every two weeks by default; weekly or daily if you switch it on.",
  /** Что значит «gap» у источника. */
  gapDefinition: "“Gap” = cited in answers that name a competitor but not the client.",
  /**
   * Сырые ответы хранятся — инвариант 6. Инструмента переобработки истории
   * нет, поэтому обещаем только то, что ответ лежит и его можно перечитать.
   */
  answersStored:
    "Every answer is stored as it came back, with its model version and cost, so any figure can be checked against the text behind it.",
  /**
   * Диапазон вклада действия — фиксированная полоса вокруг точечной оценки
   * (reports/build.ts), а не интервал из данных. Так и сказано.
   */
  contributionBand:
    "An action's estimated contribution is shown as a band of roughly 30% either side of the estimate, rounded outward. It marks the figure as rough; it is not a statistical interval.",
  /**
   * Подпись к примеру эксперимента, где нетронутые темы были. Сравнение идёт
   * с ними, а не с «базовой линией платформы»: такого метода в продукте нет.
   */
  experimentRecord:
    "This is a record of what was done and what followed, compared with topics the work did not touch. It is evidence, not attribution of cause.",
  /**
   * Как работает эксперимент — описание метода (контракт C5). Дата — момент,
   * когда действие отмечено сделанным; отдельной даты «выкатили» нет.
   * Группа сравнения — другие темы того же клиента, которых работа не касалась.
   */
  experimentMethod:
    "When a piece of work is marked done, the product compares the topics it touched with the client's other topics that it left alone, over the same weeks, and shows the difference as an estimate with a confidence level. It is a record of what followed, not a claim about why.",
  /** Без нетронутых тем сравнивать не с чем, и отчёт это говорит. */
  experimentWithoutControl:
    "Without untouched topics there is nothing to compare against, and the report says so instead of showing a difference.",
  /** Кого не измеряем и почему. */
  notMeasuredSurfaces:
    "Google AI Overviews, AI Mode and Microsoft Copilot have no official API. Standard measurement runs only through official provider APIs, so they are not part of it, and no report estimates them.",
  /** Пределы, названные вслух на главной. */
  limits: {
    quarter:
      "Assistants' search results and cited sources change over weeks. Sixty to ninety days is the honest unit here; a short period shows early signal rather than settled results.",
    attribution:
      "With one client and no untouched topics to compare against, movement cannot be separated from platform-wide drift, and the report says so where that is the case.",
    ranges:
      "A share comes with a range that depends on how many answers sit behind it. An action's estimated contribution is shown as a rough band around the estimate, next to a confidence level, so it never reads as an exact number.",
    revenue:
      "Visibility is a share of answers. What that share is worth belongs to your client's model, not to ours.",
    nothingPublished:
      "The product reads what assistants already answer and tells you what it found. Anything that changes a client's site stays a human decision.",
  },
  /** Аудит: снимок, а не прогноз. */
  auditNotForecast:
    "The ranked work is what the current sources suggest, with expected effort. It does not predict what share of answers the client will reach.",
  auditSnapshot:
    "One pass shows where the client stands this week. Movement needs repeated measurements over weeks; sixty to ninety days is the honest unit.",
  /**
   * Почему аудит не мгновенный. Срок не обещаем: он зависит от числа
   * вопросов и от очереди, а обещание, которое нельзя сдержать, хуже молчания.
   */
  auditTakesTime:
    "Each question is asked several times on ChatGPT and Perplexity. It takes longer than a page load, on purpose: one answer per question would be noise.",
  /**
   * Белая этикетка. Абсолюты вроде «ничего нашего» не говорим: ссылка живёт на
   * нашем домене, письмо уходит с нашего адреса отправки.
   */
  whiteLabel: {
    page: "The client sees your logo and color. The report page does not name us, link to us or mention a plan.",
    link: "The link opens without an account. It can be served from a domain you own (ask us and we set it up), and on that domain nothing but the report exists.",
    email:
      "Sent from the product, the email shows your agency's name as the sender, comes from noreply@answertally.com, and replies go to whoever on your team sent it. To keep even that address out of sight, send the link from your own mailbox.",
    pdf: "You can download the same page as a PDF to forward. The client's link has an approve step, not a download button.",
    approve:
      "The client approves the report, and the next sprint in it, by typing their name on the page. The name and the date are recorded.",
  },
} as const;

/**
 * Страница /method — публичная методология. Каждое утверждение здесь должно
 * совпадать с кодом: пороги и числа страница берёт из констант продукта
 * (MIN_SAMPLES_PER_CELL, SAMPLE_CONFIDENCE_THRESHOLDS, BASELINE_WINDOW_DAYS),
 * а тексты — отсюда, чтобы их проверял тот же grep-тест.
 */
export const METHOD_COPY = {
  lead: "Assistants rarely give the same answer twice. So we never report a single answer: we ask each question several times, count how often your client is named, and show how sure that count is.",
  noRank:
    "We do not report a “rank in ChatGPT”. Ask the same question twice and the list of brands changes, so a position read off one answer says very little.",
  /** Внешнее исследование — с атрибуцией и ссылкой рядом, не как наш факт. */
  sparkToro:
    "SparkToro asked AI tools the same recommendation questions many times and found the list of brands almost never repeated: fewer than 1 in 100 runs gave the same list.",
  instead:
    "What we report instead is visibility: the share of sampled answers that name the brand, per assistant. Assistants are shown side by side, never blended into one score.",
  prominence:
    "Inside the workspace we also show how the client is named when it is named: in how many answers it comes first, or ahead of every tracked competitor. That is a count across samples too, not a position read off one answer.",
  questions:
    "Questions are the buyer prompts you track for a client. You can generate a first draft from templates, import your own list, and edit either until it reads the way buyers actually ask.",
  samples:
    "By default each question is asked three times on each assistant you switch on, every run, and you can ask more. A cell with fewer than three answers in its window shows a dash instead of a number.",
  api: "Each assistant is asked through its developer API with web search switched on, not through the consumer app. What a person sees in the app can differ.",
  sources: "Every answer is stored with the pages it cited, so each figure can be traced to answers and sources.",
  windows:
    "Answers are grouped by week. Screens add up a rolling window (the last 28 days by default) so a figure rests on more answers; reports compare the start of the period with the end.",
  interval:
    "The range around a share is a 95% interval worked out from the number of answers behind it. Few answers, wide range.",
  withinNoise:
    "When two periods' ranges overlap, the change is labeled as within what the sample can tell apart, not as up or down.",
  confidence:
    "Confidence describes how many answers sit behind a figure, not how good the result is. The same thresholds apply on every screen, in reports and in the API.",
  experiments:
    "An experiment compares the topics a piece of work touched with the client's other topics that it did not touch, over the same weeks. The baseline is the 28 days before the work was marked done.",
  estimate:
    "The change in the touched topics minus the change in the untouched ones, from the baseline to the weeks after the work.",
  rangeExampleNote: "Worked with the same 95% interval the product uses, on a 0–100% axis.",
  experimentConfidence:
    "Its confidence comes from whether untouched topics exist and stayed steady, how many answers came in afterwards, how deep the baseline is, and whether a new source started being cited.",
  experimentLimits:
    "Untouched topics of the same client are a stand-in for a comparison group, not a true one. Without them, the report says movement cannot be separated from platform-wide change.",
  kept: "Recorded on every answer: the raw text, the pages it cited, the model version that produced it, and what it cost to ask.",
  decisions:
    "Human decisions stay put. A recalculation never overwrites what your team decided about an opportunity.",
  neverClaim: [
    "A rank or position in any assistant",
    "A single 0–100 visibility score",
    "That a piece of work produced a change: we show what followed, with a comparison where one exists",
    "A forecast of the share a client will reach",
    "A revenue figure for visibility",
    "Anything about assistants we do not measure",
  ],
} as const;

export const EXPERIMENT_COPY = {
  /** Заголовок оценки эффекта: всегда «estimated» — см. инвариант 2. */
  estimatedEffect: "Estimated incremental effect",
  /**
   * Дисклеймер под результатом эксперимента.
   *
   * Называет ровно то, с чем сравнивает `estimateExperiment`: недели до
   * действия и, если они есть, нетронутые темы за тот же период. Раньше здесь
   * стояло «platform baseline» — такого сравнения в расчёте нет.
   */
  attributionLimits:
    "This is a record of what was done and what followed, compared with the weeks before it and, where there are untouched topics, with how they moved over the same period. It is evidence, not attribution of cause.",
} as const;
