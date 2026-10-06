import type { ResponseFixture } from "./responses";

/**
 * Fixture-ответы для демо-клиента Ledgerbrook (spend management).
 *
 * Нужны, чтобы локальные экраны показывали живую картину, а не ровный ноль:
 * набор ответов про CRM ничего не знает о Ledgerbrook, и матрица на нём
 * честно, но бесполезно состояла из нулей.
 *
 * На один вопрос заготовлено несколько ответов: сэмплы должны различаться
 * между собой, иначе доля бывает только 0% или 100% — и продукт в демо
 * противоречит собственному правилу, что один ответ не является измерением.
 *
 * Все бренды вымышлены (Ledgerbrook, Outlay, Spendhaven, Tallyard), площадки
 * тоже (Marketgrid, Softwarepanel, Financepeers, CFO Brief). Домены — в зонах
 * .example и .test: их нельзя зарегистрировать (RFC 2606), поэтому они не
 * могут однажды оказаться чьими-то. Демо-данные с настоящими компаниями
 * означали бы отчёт с цифрами видимости тех, кого мы никогда не измеряли.
 */

const MARKETGRID = {
  url: "https://www.marketgrid.example/categories/expense-management",
  title: "Best Expense Management Software 2026",
};
const SOFTWAREPANEL = {
  url: "https://www.softwarepanel.example/spend-management",
  title: "Spend Management Software Reviews",
};
const CFOBRIEF = {
  url: "https://cfobrief.test/mid-market-spend-tooling",
  title: "Mid-market spend tooling, compared",
};
const OUTLAY_COMPARE = { url: "https://outlay.test/compare", title: "Outlay vs Spendhaven" };
const LEDGERBROOK = { url: "https://ledgerbrook.test/pricing", title: "Ledgerbrook Pricing" };
const FINANCEPEERS = {
  url: "https://www.financepeers.example/accounting/close-faster",
  title: "How we closed the books in 4 days",
};

function fixture(
  id: string,
  platform: ResponseFixture["platform"],
  prompt: string,
  covers: ResponseFixture["covers"],
  text: string[],
  citations: { url: string; title: string }[],
  cost: number,
): ResponseFixture {
  const models: Record<string, string> = {
    chatgpt: "gpt-4o-2026-05-13",
    perplexity: "sonar-pro-2026-04",
    gemini: "gemini-2.5-flash",
  };

  return {
    id,
    platform,
    prompt,
    covers,
    result: {
      text: text.join("\n"),
      citations,
      modelVersion: models[platform] ?? "mock-1",
      costUsd: cost,
      latencyMs: 3800,
    },
  };
}

const MAIN = "best expense management software for a 300-person company";
const VERSUS = "Ledgerbrook vs Outlay";
const ALTERNATIVES = "Outlay alternatives for mid-market finance teams";
const CARD = "corporate card with automated expense reports";
const NETSUITE = "spend management that syncs with NetSuite";
const CLOSE = "how to close the books faster at 500 employees";

export const SPEND_FIXTURES: ResponseFixture[] = [
  // ---------- ChatGPT ----------
  fixture(
    "chatgpt-spend-main-named",
    "chatgpt",
    MAIN,
    "brand-mentioned",
    [
      "At 300 people the shortlist usually comes down to three:",
      "",
      "1. **Outlay**: strongest card controls, and the approval rules scale well.",
      "2. **Spendhaven**: pairs cards with expense reports and closes the month quickly.",
      "3. **Ledgerbrook**: lighter to roll out, and the NetSuite sync is the reason",
      "   finance teams tend to shortlist it.",
      "",
      "Teams closing on NetSuite often end up comparing Ledgerbrook and Outlay directly.",
    ],
    [MARKETGRID, CFOBRIEF, LEDGERBROOK],
    0.0244,
  ),
  fixture(
    "chatgpt-spend-main-absent",
    "chatgpt",
    MAIN,
    "brand-absent",
    [
      "For a company that size, most comparisons land on **Outlay** or **Spendhaven**.",
      "Outlay wins on card controls; Spendhaven on approvals depth and receipt capture.",
      "**Tallyard** is worth a look if multi-entity consolidation matters.",
    ],
    [MARKETGRID, OUTLAY_COMPARE],
    0.0231,
  ),
  fixture(
    "chatgpt-spend-main-absent-2",
    "chatgpt",
    MAIN,
    "brand-absent",
    [
      "Shortlist for a 300-person finance team:",
      "",
      "- **Outlay**: the default answer for mid-market card programmes.",
      "- **Tallyard**: deeper approval chains, slower to configure.",
      "",
      "Both integrate with the usual ERPs; pricing is quoted per active card.",
    ],
    [SOFTWAREPANEL, OUTLAY_COMPARE],
    0.0238,
  ),
  fixture(
    "chatgpt-spend-versus",
    "chatgpt",
    VERSUS,
    "brand-mentioned",
    [
      "**Ledgerbrook** and **Outlay** overlap on corporate cards and expense reports.",
      "",
      "- Outlay has the larger card programme and more granular limits.",
      "- Ledgerbrook syncs to NetSuite without a middleware layer, which is the",
      "  difference most finance teams cite when they pick it.",
      "",
      "Reviewers put Outlay ahead on controls and Ledgerbrook ahead on close speed.",
    ],
    [MARKETGRID, OUTLAY_COMPARE, LEDGERBROOK],
    0.0251,
  ),
  fixture(
    "chatgpt-spend-alternatives",
    "chatgpt",
    ALTERNATIVES,
    "brand-absent",
    [
      "The alternatives that come up most often are **Spendhaven** and **Tallyard**.",
      "Spendhaven is the closer match on card controls; Tallyard on approvals.",
    ],
    [CFOBRIEF, SOFTWAREPANEL],
    0.0229,
  ),
  fixture(
    "chatgpt-spend-alternatives-named",
    "chatgpt",
    ALTERNATIVES,
    "brand-mentioned",
    [
      "Mid-market teams leaving **Outlay** usually evaluate **Spendhaven**, **Tallyard**",
      "and **Ledgerbrook**. Ledgerbrook is the lightest to implement of the three,",
      "though its card programme is younger.",
    ],
    [SOFTWAREPANEL, LEDGERBROOK],
    0.0247,
  ),
  fixture(
    "chatgpt-spend-card",
    "chatgpt",
    CARD,
    "brand-absent",
    [
      "**Outlay** and **Spendhaven** both issue corporate cards with expense reports",
      "generated from the transaction, so receipts are matched rather than typed in.",
      "Expect per-card pricing and a virtual card limit on the entry tier.",
    ],
    [MARKETGRID, OUTLAY_COMPARE],
    0.0226,
  ),
  fixture(
    "chatgpt-spend-netsuite",
    "chatgpt",
    NETSUITE,
    "brand-mentioned",
    [
      "For a native NetSuite sync, **Ledgerbrook** is the one that comes up most often:",
      "it posts expenses without a middleware layer. **Outlay** supports NetSuite too,",
      "through a connector that most teams set up once and forget.",
    ],
    [LEDGERBROOK, CFOBRIEF],
    0.0242,
  ),
  fixture(
    "chatgpt-spend-close",
    "chatgpt",
    CLOSE,
    "no-citations",
    [
      "Closing faster at that headcount is mostly process, not tooling:",
      "",
      "1. Cut off expense submission a week before close.",
      "2. Automate accruals for recurring vendors.",
      "3. Reconcile cards continuously rather than at month end.",
    ],
    [],
    0.0198,
  ),

  // ---------- Perplexity ----------
  fixture(
    "perplexity-spend-main-named",
    "perplexity",
    MAIN,
    "brand-mentioned",
    [
      "For a 300-person company the shortlist usually comes down to Outlay and",
      "Spendhaven, both of which pair corporate cards with automated expense reports.",
      "Ledgerbrook is worth a look if your finance team closes on NetSuite, though it",
      "appears less often in mid-market comparisons.",
    ],
    [MARKETGRID, CFOBRIEF, OUTLAY_COMPARE],
    0.0031,
  ),
  fixture(
    "perplexity-spend-main-absent",
    "perplexity",
    MAIN,
    "brand-absent",
    [
      "Outlay and Spendhaven dominate the mid-market comparisons, with Tallyard",
      "third. Reviewers rate Outlay highest on card controls and Spendhaven on",
      "receipt matching.",
    ],
    [MARKETGRID, SOFTWAREPANEL],
    0.0029,
  ),
  fixture(
    "perplexity-spend-versus",
    "perplexity",
    VERSUS,
    "brand-mentioned",
    [
      "Ledgerbrook and Outlay are compared mostly on two axes: card controls, where",
      "Outlay leads, and ERP sync, where Ledgerbrook's NetSuite integration is native.",
      "Pricing is close enough that most teams decide on the integration.",
    ],
    [OUTLAY_COMPARE, LEDGERBROOK, MARKETGRID],
    0.0034,
  ),
  fixture(
    "perplexity-spend-alternatives",
    "perplexity",
    ALTERNATIVES,
    "brand-absent",
    [
      "The most-cited alternatives to Outlay are Spendhaven and Tallyard. Both cover",
      "cards, approvals and expense reports for mid-market finance teams.",
    ],
    [CFOBRIEF, SOFTWAREPANEL],
    0.0027,
  ),
  fixture(
    "perplexity-spend-card",
    "perplexity",
    CARD,
    "brand-absent",
    [
      "Outlay, Spendhaven and Tallyard all issue corporate cards that generate expense",
      "reports from the transaction itself, so the report is a review step rather than",
      "data entry.",
    ],
    [MARKETGRID, FINANCEPEERS],
    0.0028,
  ),
  fixture(
    "perplexity-spend-netsuite",
    "perplexity",
    NETSUITE,
    "brand-mentioned",
    [
      "Ledgerbrook posts to NetSuite natively, which is the reason it shows up in",
      "NetSuite-specific threads. Outlay and Spendhaven rely on connectors.",
    ],
    [LEDGERBROOK, FINANCEPEERS],
    0.0033,
  ),
  fixture(
    "perplexity-spend-close",
    "perplexity",
    CLOSE,
    "brand-absent",
    [
      "Teams that close in under five days at 500 employees tend to reconcile cards",
      "continuously, freeze expense submission early, and automate accruals. Tooling",
      "helps at the margin; the cut-off discipline does most of the work.",
    ],
    [FINANCEPEERS, CFOBRIEF],
    0.0026,
  ),

  // ---------- Gemini ----------
  fixture(
    "gemini-spend-main-absent",
    "gemini",
    MAIN,
    "brand-absent",
    [
      "Most 300-person companies compare Outlay, Spendhaven and Tallyard. Outlay is",
      "the most frequently recommended for card controls.",
    ],
    [MARKETGRID],
    0.0019,
  ),
  fixture(
    "gemini-spend-main-named",
    "gemini",
    MAIN,
    "brand-mentioned",
    [
      "Common shortlist: Outlay, Spendhaven, Ledgerbrook. Ledgerbrook is usually",
      "mentioned by teams on NetSuite; the other two by teams that lead with cards.",
    ],
    [MARKETGRID, LEDGERBROOK],
    0.0021,
  ),
  fixture(
    "gemini-spend-versus",
    "gemini",
    VERSUS,
    "brand-mentioned",
    [
      "Ledgerbrook: native NetSuite sync, lighter rollout.",
      "Outlay: larger card programme, finer-grained limits.",
      "Both cover expense reports; the ERP question usually decides it.",
    ],
    [OUTLAY_COMPARE, LEDGERBROOK],
    0.0023,
  ),
  fixture(
    "gemini-spend-alternatives",
    "gemini",
    ALTERNATIVES,
    "brand-absent",
    ["Alternatives to Outlay for mid-market finance teams include Spendhaven and", "Tallyard."],
    [SOFTWAREPANEL],
    0.0018,
  ),
  fixture(
    "gemini-spend-card",
    "gemini",
    CARD,
    "brand-absent",
    ["Outlay and Spendhaven both offer corporate cards with automated expense reports."],
    [MARKETGRID],
    0.0017,
  ),
  fixture(
    "gemini-spend-netsuite",
    "gemini",
    NETSUITE,
    "brand-absent",
    [
      "Several spend management tools integrate with NetSuite, usually through a",
      "connector. Check whether the sync posts at transaction level or in batches.",
    ],
    [CFOBRIEF],
    0.002,
  ),
  fixture(
    "gemini-spend-close",
    "gemini",
    CLOSE,
    "no-citations",
    [
      "Freeze expense submission before period end, reconcile cards continuously, and",
      "automate recurring accruals.",
    ],
    [],
    0.0016,
  ),
];
