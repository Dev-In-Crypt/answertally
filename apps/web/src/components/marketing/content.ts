import {
  DEFAULT_PLATFORMS,
  MARKETING_COPY,
  VOLUME_ACCOUNT_PRICE_USD,
  VOLUME_DISCOUNT,
  VOLUME_THRESHOLD,
} from "@repo/core";
import {
  PER_CLIENT_MAX,
  PER_CLIENT_MIN,
  TYPICAL_CHECKS_BIWEEKLY,
  MEASURABLE_ASSISTANT_COUNT,
  TYPICAL_CHECKS_ALL_ASSISTANTS,
  TYPICAL_CHECKS_PER_CLIENT,
  int,
  usd,
} from "./data";

/**
 * Тексты витрины, которые повторяются на нескольких страницах.
 *
 * Граница с `packages/core/src/copy.ts` такая: всё, что объясняет, **что
 * означает цифра** и как она измерена, и всё про белую этикетку берётся
 * оттуда константой — иначе продукт и витрина начнут объяснять метрику
 * по-разному. Остальное (позиционирование, кому это надо, как купить,
 * возражения) живёт здесь.
 */

/**
 * Контакт для разговора о тарифе.
 *
 * Значение приходит из настроек окружения (`apps/web/src/config/site.ts`), а
 * не лежит здесь константой: иначе появление адреса требовало бы правки кода
 * и выкладки. Пока адреса нет, витрина не обещает звонок — везде, где нужен
 * контакт, стоит путь через бесплатный аудит.
 */
export { SALES_CONTACT } from "@/config/site";
export type { SalesContact } from "@/config/site";

/**
 * Условия тарифов — только утверждённые основателем. Намеренно не сказано,
 * входит ли API в каждый план и считается ли клиент-проспект из бесплатного
 * аудита в лимит клиентов: это не решено, и витрина не должна решать за него.
 */
export const PRICING_NOTES = {
  unit: "Billed per client account. Not per seat, not per source, not per prompt.",
  included:
    "Every plan includes measurement, diagnosis, the actions board, experiments, white-label reports and PDF export.",
  frame: "Priced against the retainer revenue it supports, not against the price of a rank tracker.",
  /**
   * Allowance рассчитан на еженедельный опрос, а по умолчанию продукт опрашивает
   * раз в две недели — названы оба числа, чтобы запас не выглядел выдуманным.
   */
  checks: `One AI check is one assistant answering one prompt once. A client measured the default way (around two dozen prompts, three samples each, three assistants, every two weeks) uses roughly ${int(TYPICAL_CHECKS_BIWEEKLY)} checks a month. Measured weekly, it uses roughly ${int(TYPICAL_CHECKS_PER_CLIENT)} checks, and each plan still covers every client, with up to 40% to spare.`,
  /**
   * Лимит — потолок: следующий прогон сверх него не начнётся (решение
   * фаундера, после аудита расходов). Начатый не обрывается. Обещание
   * «ничего не отключаем» сняли вместе с поведением, иначе текст лгал бы.
   */
  overage:
    "The allowance is a ceiling: a check that would go past it does not start, and one already running always finishes. The usage bar on your dashboard shows where you stand; measuring resumes on the 1st, or write to us to raise the allowance.",
  /**
   * Что происходит на потолке — включая потолок старшего тарифа, за которым
   * следующего плана уже нет. Пока здесь об этом молчали, ответ на самый
   * частый вопрос агентства с большой книгой был «напишите нам».
   */
  clientLimit: `The plan sets how many client accounts the workspace can hold at once. Adding one beyond that means moving to the next plan, and the product asks you to rather than failing quietly. Above the top plan there is no next one: from the ${VOLUME_THRESHOLD}th account every further account is ${usd(VOLUME_ACCOUNT_PRICE_USD)} a month, ${Math.round(VOLUME_DISCOUNT * 100)}% off what the top plan works out to per account.`,
  seats: "The number of people on your team is not counted, and there is no charge per seat.",
  /**
   * Числа и имена — из каталога и умолчания, не из текста. Прежняя
   * формулировка говорила «пять вместо трёх» и пережила два решения,
   * которые её опровергли.
   */
  extraAssistants: `The assistants your plan allows have no separate price. Switching every one of them on for a client means ${MEASURABLE_ASSISTANT_COUNT} assistants instead of the ${DEFAULT_PLATFORMS.length} measured by default, so that client uses about ${MEASURABLE_ASSISTANT_COUNT}/${DEFAULT_PLATFORMS.length} as many AI checks (roughly ${int(TYPICAL_CHECKS_ALL_ASSISTANTS)} a month if measured weekly).`,
  /**
   * Как сегодня покупают.
   *
   * Витрина не должна расходиться с продуктом: в нём кнопка оплаты стоит
   * ровно тогда, когда подключён платёжный провайдер, и обещать обратное
   * (в любую сторону) — это первое, что агентство проверит после входа.
   * Поэтому текст выбирается тем же признаком, что и сама кнопка.
   */
  checkoutSelfServe:
    "You pick a plan in the product and pay by card. If your agency would rather be invoiced, say so and we set that up directly.",
  checkoutDirect: "There is no self-serve checkout yet. Plans are set up with us directly.",
  checkoutHeadingSelfServe: "Pick a plan and pay by card",
  checkoutHeadingDirect: "No self-serve checkout yet",
  checkoutLeadSelfServe:
    "Start with the free audit on a brand you work on, then pick a plan in the product and pay by card. Cards are handled by the payment provider; we never see the number.",
  checkoutLeadDirect:
    "Start with the free audit on a brand you work on. Plans and billing are then set up with us directly; there is no “Buy now” button to pretend with.",
  stepPickTitleSelfServe: "Pick a plan in the product",
  stepPickSelfServe:
    "Choose the plan that fits how many clients you plan to measure and pay by card. If your agency would rather be invoiced, say so and we set that up directly.",
  stepBillingSelfServe:
    "The plan’s limits apply as soon as the payment provider confirms the payment.",
  stepPickTitleDirect: "Pick the plan with us",
  stepPickDirect:
    "Plans are agreed directly rather than through a checkout: say how many clients you plan to measure, and the matching plan is set up.",
  stepBillingDirect: "Billing is set up with us directly, and the plan’s limits apply from then on.",
  seoSuite:
    "Keep your SEO suite. Semrush or Ahrefs stay where your keyword and backlink work lives; Answertally is the client-facing AI-visibility layer next to them and does not try to replace them.",
};

/**
 * Что витрина говорит про покупку.
 *
 * `paymentsOn` — тот же признак, по которому продукт рисует кнопку оплаты
 * (`getPaymentProvider().configured`). Страницы серверные, поэтому берут его
 * прямо у провайдера; иначе сайт и продукт разъезжаются молча.
 */
export function checkoutCopy(paymentsOn: boolean): {
  heading: string;
  lead: string;
  note: string;
  faqAnswer: string;
  stepPickTitle: string;
  stepPick: string;
  stepBilling: string;
} {
  return paymentsOn
    ? {
        heading: PRICING_NOTES.checkoutHeadingSelfServe,
        lead: PRICING_NOTES.checkoutLeadSelfServe,
        note: PRICING_NOTES.checkoutSelfServe,
        faqAnswer: `Yes. ${PRICING_NOTES.checkoutSelfServe}`,
        stepPickTitle: PRICING_NOTES.stepPickTitleSelfServe,
        stepPick: PRICING_NOTES.stepPickSelfServe,
        stepBilling: PRICING_NOTES.stepBillingSelfServe,
      }
    : {
        heading: PRICING_NOTES.checkoutHeadingDirect,
        lead: PRICING_NOTES.checkoutLeadDirect,
        note: PRICING_NOTES.checkoutDirect,
        faqAnswer: `Not yet. ${PRICING_NOTES.checkoutDirect}`,
        stepPickTitle: PRICING_NOTES.stepPickTitleDirect,
        stepPick: PRICING_NOTES.stepPickDirect,
        stepBilling: PRICING_NOTES.stepBillingDirect,
      };
}

/**
 * Внешняя цифра о рынке — только с источником и ссылкой рядом. Своих
 * рыночных цифр витрина не приводит.
 */
export const MARKET_NOTE = {
  text: "66% of agencies say clients are asking them for AI search work, now the most requested new service.",
  source: "AgencyAnalytics, 2026 agency benchmarks",
  href: "https://agencyanalytics.com/agency-benchmarks-2026",
};

/** Исследование непостоянства ответов, на которое опирается отказ от «позиции». */
export const SPARKTORO_STUDY = {
  label: "SparkToro: AIs are highly inconsistent when recommending brands",
  href: "https://sparktoro.com/blog/new-research-ais-are-highly-inconsistent-when-recommending-brands-or-products-marketers-should-take-care-when-tracking-ai-visibility/",
};

/**
 * Шаги аудита — ровно то, что делает продукт. Срока не обещаем: он зависит
 * от числа вопросов и очереди.
 */
export const AUDIT_STEPS: { text: string; who: { label: string; ours?: boolean }[] }[] = [
  { text: "Create your workspace. No card is asked for.", who: [{ label: "you" }] },
  {
    text: "Add the client and the competitors you want it compared with",
    who: [{ label: "you" }],
  },
  {
    text: "Generate the buyer questions from templates, or import your own list, then edit them until they read the way buyers ask",
    who: [{ label: "drafted for you", ours: true }, { label: "you edit" }],
  },
  {
    text: "Run the audit: every question, several times, on ChatGPT and Perplexity",
    who: [{ label: "the product asks", ours: true }],
  },
  {
    text: "Read the diagnosis and the ranked work, then generate the report in your brand and send it when you are ready",
    who: [{ label: "built for you", ours: true }, { label: "you send" }],
  },
];

export const LIMITS = [
  { title: "A quarter, not a week", body: MARKETING_COPY.limits.quarter },
  { title: "Movement, not attribution", body: MARKETING_COPY.limits.attribution },
  { title: "Ranges, not exact numbers", body: MARKETING_COPY.limits.ranges },
  { title: "No revenue figure invented for you", body: MARKETING_COPY.limits.revenue },
  { title: "Only assistants with a public API", body: MARKETING_COPY.notMeasuredSurfaces, offChips: true },
  { title: "Nothing is published for you", body: MARKETING_COPY.limits.nothingPublished },
];

export const AUDIENCE = {
  forYou: [
    "SEO, content and digital agencies with 10–100 retainer clients",
    "Teams already asked by clients what ChatGPT says about them",
    "Agencies that want to sell a new service to the client base they have",
  ],
  notForYou: [
    "Solo creators and local businesses",
    "Brands looking for a visibility dashboard and nothing else",
    "Anyone who needs content generated automatically and published without review",
  ],
};

/**
 * Возражения — словами покупателя (см. исследование голоса клиента), ответы —
 * без обещаний результата.
 */
export const OBJECTIONS = [
  {
    q: "“AEO, GEO… isn’t this snake oil?”",
    a: "Some of what is sold under those names is. The part that is not is simple: buyers ask assistants what to use, and you can count how often your client is named in the answers. That is what we measure, with the working shown. No score, and no promise of a placement.",
  },
  {
    q: "“AI answers change every time. The numbers are noise.”",
    a: "One answer is noise, which is why we never report one. No figure rests on fewer than three answers per question per assistant, shares come with their range and a confidence level, and a change the sample cannot tell apart is labelled that way instead of being sold as a win.",
  },
  {
    q: "“We don’t need another dashboard.”",
    a: "Neither does your client. What comes out is ranked work with a reason on every item, and a report in your brand that the client approves by link. The screens are there so your team can check the working.",
  },
  {
    q: "“Too expensive for a service we haven’t sold yet.”",
    a: `Per client it works out at about ${usd(PER_CLIENT_MIN)}–${usd(PER_CLIENT_MAX)} a month depending on the plan, with your whole team included. The audit is free, so you can price your own offer on real output before any plan is agreed.`,
  },
  {
    q: "“We already pay for Semrush and Ahrefs.”",
    a: `${PRICING_NOTES.seoSuite} It does not do keywords or backlinks, on purpose.`,
  },
  {
    q: "“Will my client see your name?”",
    a: `${MARKETING_COPY.whiteLabel.page} ${MARKETING_COPY.whiteLabel.link}`,
  },
];

/** Подписи калькулятора перепродажи: арифметика на числах агентства, не прогноз. */
export const RESALE = {
  title: "What the service could bring in, on your numbers",
  intro:
    "Type what you would charge a client for AI visibility each month and how many clients might take it. The defaults are illustrative starting values, not a market rate.",
  caveat:
    "Arithmetic on the numbers you enter, not a forecast. It leaves out your team’s time and whether clients say yes.",
  defaultPriceUsd: 1000,
  defaultClients: 10,
};
