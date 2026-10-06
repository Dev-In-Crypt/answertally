import type { AdapterResult, Platform } from "../adapters/types";
import { SPEND_FIXTURES } from "./spend-responses";
import { GAP_FIXTURES } from "./gap-responses";

/**
 * Fixture-ответы платформ. На них держится весь пайплайн в mock-режиме
 * и все тесты парсера (T18) — сеть в тестах не используется никогда.
 *
 * Клиент в этих данных — AcmeCRM (как в seed), конкуренты — Northstack, Pipewell, Clasp.
 * Каждая платформа покрывает три случая:
 *   1. бренд упомянут явно и есть citations;
 *   2. бренд упомянут только под alias ("Acme CRM" / "Acme");
 *   3. бренда нет вовсе (для одного из вариантов — ещё и без citations).
 *
 * Все процитированные площадки вымышлены (Reviewgrid, Softwarepicks,
 * Vendorverdict, Shortlister, Saaspeers, CRM Digest, Market Ledger, Pipewell),
 * домены — в зонах .example и .test: их нельзя зарегистрировать (RFC 2606).
 * Настоящий домен рядом с выдуманной долей упоминаний — это приписанное
 * третьему лицу утверждение, которого мы не измеряли.
 */

export interface ResponseFixture {
  id: string;
  platform: Platform;
  prompt: string;
  /** Что именно проверяет этот случай — читается в отчётах о падениях тестов. */
  covers: "brand-mentioned" | "brand-alias-only" | "brand-absent" | "no-citations";
  result: AdapterResult;
}

export const RESPONSE_FIXTURES: ResponseFixture[] = [
  // ---------- ChatGPT ----------
  {
    id: "chatgpt-best-crm",
    platform: "chatgpt",
    prompt: "best CRM for startups",
    covers: "brand-mentioned",
    result: {
      text: [
        "For early-stage startups, the CRMs that come up most often are:",
        "",
        "1. **Northstack**: generous free tier, though pricing escalates once you need automation.",
        "2. **Pipewell**: pipeline-first and easy for a small sales team to adopt.",
        "3. **AcmeCRM**: lighter than Northstack, with an API that developer-heavy teams like.",
        "4. **Clasp**: built around calling and email sequences.",
        "",
        "If you expect to outgrow a spreadsheet within a year, Pipewell and AcmeCRM are the",
        "two most commonly recommended starting points.",
      ].join("\n"),
      citations: [
        {
          url: "https://www.reviewgrid.example/categories/crm",
          title: "CRM Software Reviews 2026 | Reviewgrid",
        },
        {
          url: "https://blog.crmdigest.example/best-crm-for-startups",
          title: "The Best CRM for Startups",
        },
        { url: "https://acmecrm.test/pricing", title: "AcmeCRM Pricing" },
      ],
      modelVersion: "gpt-4o-2026-05-13",
      costUsd: 0.0121,
      latencyMs: 4210,
    },
  },
  {
    id: "chatgpt-hubspot-alternatives",
    platform: "chatgpt",
    prompt: "Northstack alternatives",
    covers: "brand-alias-only",
    result: {
      text: [
        "Teams leaving Northstack usually evaluate Pipewell, Clasp, and Acme CRM.",
        "",
        "Acme CRM tends to win on API flexibility, while Pipewell is the simpler switch",
        "for a sales team that mostly needs a pipeline view. Clasp is worth a look if",
        "outbound calling is central to how you sell.",
      ].join("\n"),
      citations: [
        {
          url: "https://www.softwarepicks.example/crm-software/",
          title: "CRM Software Reviews | Softwarepicks",
        },
        { url: "https://forum.saaspeers.example/sales/hubspot-alternatives" },
      ],
      modelVersion: "gpt-4o-2026-05-13",
      costUsd: 0.0098,
      latencyMs: 3870,
    },
  },
  {
    id: "chatgpt-crm-for-smb",
    platform: "chatgpt",
    prompt: "easiest CRM for a small sales team",
    covers: "brand-absent",
    result: {
      text: [
        "For a small sales team, the usual recommendations are Pipewell for its",
        "pipeline-first interface, Northstack for its free tier, and Clasp for teams that",
        "live on the phone. Vantoria Essentials exists but is generally more than a",
        "small team needs.",
      ].join("\n"),
      citations: [
        { url: "https://www.pipewell.example/features", title: "Pipewell Features" },
        {
          url: "https://www.reviewgrid.example/categories/crm",
          title: "CRM Software Reviews 2026 | Reviewgrid",
        },
      ],
      modelVersion: "gpt-4o-2026-05-13",
      costUsd: 0.0089,
      latencyMs: 3520,
    },
  },

  // ---------- Perplexity ----------
  {
    id: "perplexity-best-crm",
    platform: "perplexity",
    prompt: "best CRM for startups",
    covers: "brand-mentioned",
    result: {
      text: [
        "The most frequently recommended CRMs for startups in 2026 are Northstack, Pipewell,",
        "AcmeCRM and Clasp.",
        "",
        "Northstack leads on breadth of features. Pipewell is the most common pick for teams",
        "under ten people. AcmeCRM is cited for its API and lower entry pricing. Clasp is",
        "specialised around outbound sales workflows.",
      ].join("\n"),
      citations: [
        {
          url: "https://www.reviewgrid.example/categories/crm",
          title: "CRM Software Reviews 2026 | Reviewgrid",
        },
        {
          url: "https://www.vendorverdict.example/crm",
          title: "CRM Software Reviews and Ratings",
        },
        { url: "https://acmecrm.test/blog/crm-for-startups", title: "AcmeCRM for startups" },
        {
          url: "https://forum.saaspeers.example/startups/which-crm",
          title: "Which CRM are you using?",
        },
      ],
      modelVersion: "sonar-pro-2026-04",
      costUsd: 0.006,
      latencyMs: 2980,
    },
  },
  {
    id: "perplexity-crm-api",
    platform: "perplexity",
    prompt: "CRM with an open API",
    covers: "brand-alias-only",
    result: {
      text: [
        "CRMs with well-documented public APIs include Northstack, Pipewell, Clasp and Acme.",
        "",
        "Acme documents webhooks and a REST API with generous rate limits, which is why it",
        "shows up in developer-focused comparisons.",
      ].join("\n"),
      citations: [
        { url: "https://developers.pipewell.example/api/overview", title: "Pipewell API" },
        { url: "https://acmecrm.test/docs/api", title: "AcmeCRM API reference" },
      ],
      modelVersion: "sonar-pro-2026-04",
      costUsd: 0.0055,
      latencyMs: 2640,
    },
  },
  {
    id: "perplexity-what-is-crm",
    platform: "perplexity",
    prompt: "what is a sales CRM",
    covers: "no-citations",
    result: {
      text: [
        "A sales CRM is a system of record for customer relationships: contacts, companies,",
        "deals and the activity history against them. It replaces the spreadsheet a team",
        "starts with, and gives forecasting and pipeline visibility once deal volume grows.",
      ].join("\n"),
      // Общеобразовательный вопрос — модель отвечает из параметрической памяти, ссылок нет.
      citations: [],
      modelVersion: "sonar-pro-2026-04",
      costUsd: 0.0031,
      latencyMs: 1890,
    },
  },

  // ---------- Gemini ----------
  {
    id: "gemini-best-crm",
    platform: "gemini",
    prompt: "best CRM for startups",
    covers: "brand-mentioned",
    result: {
      text: [
        "Popular CRM choices for startups include:",
        "",
        "* Northstack: strong free tier and marketing tooling",
        "* Pipewell: straightforward pipeline management",
        "* AcmeCRM: developer-friendly, cheaper at the entry tier",
        "",
        "The right pick depends on whether your motion is inbound marketing or outbound sales.",
      ].join("\n"),
      citations: [
        {
          url: "https://www.reviewgrid.example/categories/crm",
          title: "CRM Software Reviews | Reviewgrid",
        },
        {
          url: "https://news.marketledger.example/business/best-crm-for-startups/",
          title: "Best CRM For Startups Of 2026 – Market Ledger",
        },
      ],
      modelVersion: "gemini-2.5-pro",
      costUsd: 0.0042,
      latencyMs: 3110,
    },
  },
  {
    id: "gemini-crm-small-team",
    platform: "gemini",
    prompt: "easiest CRM for a small sales team",
    covers: "brand-alias-only",
    result: {
      text: [
        "For a small team, Pipewell and Acme are usually the easiest to get running in a day.",
        "Northstack is more capable but takes longer to configure, and Clasp assumes a calling-heavy",
        "workflow.",
      ].join("\n"),
      citations: [
        {
          url: "https://www.softwarepicks.example/crm-software/",
          title: "CRM Software Reviews | Softwarepicks",
        },
      ],
      modelVersion: "gemini-2.5-pro",
      costUsd: 0.0038,
      latencyMs: 2750,
    },
  },
  {
    id: "gemini-project-management",
    platform: "gemini",
    prompt: "best project management tool for agencies",
    covers: "brand-absent",
    result: {
      text: [
        "Agencies most often use Taskline, Weekview, Gridpad or Pagevault for project management.",
        "The choice usually comes down to whether you need time tracking and client-facing",
        "views out of the box.",
      ].join("\n"),
      citations: [
        {
          url: "https://www.reviewgrid.example/categories/project-management",
          title: "Project Management Reviews | Reviewgrid",
        },
      ],
      modelVersion: "gemini-2.5-pro",
      costUsd: 0.0035,
      latencyMs: 2480,
    },
  },
];

/**
 * Полный набор: ответы про CRM (клиент AcmeCRM), ответы про spend management
 * (клиент Ledgerbrook из макетов) и ответы, в которых клиента нет, а
 * конкуренты есть. Разные наборы не смешиваются на одном вопросе — выбор идёт
 * по точному совпадению текста вопроса.
 */
export function allFixtures(): ResponseFixture[] {
  const written = [...RESPONSE_FIXTURES, ...SPEND_FIXTURES, ...GAP_FIXTURES];
  return [...written, ...derivedFixtures(written)];
}

/**
 * Ответы платформ, у которых собственных заготовок нет: Claude и Grok.
 *
 * Пересочинять вручную три набора ради режима без сети значило бы писать
 * то же самое ещё дважды. Заготовки берутся у другой платформы и переезжают
 * под новую — с новым идентификатором и меткой версии модели. Донор разный
 * (Claude от Perplexity, Grok от Gemini), чтобы доли по платформам в матрице
 * не совпадали до последнего знака.
 *
 * Это данные режима mock и ничего больше: живой адаптер отвечает своими
 * словами, и никакая цифра из этих заготовок в отчёт о настоящем клиенте
 * не попадает.
 */
const DERIVED_FROM: readonly { platform: Platform; donor: Platform; modelVersion: string }[] = [
  { platform: "claude", donor: "perplexity", modelVersion: "claude-haiku-4-5-fixture" },
  { platform: "grok", donor: "gemini", modelVersion: "grok-4-1-fast-fixture" },
];

function derivedFixtures(written: ResponseFixture[]): ResponseFixture[] {
  return DERIVED_FROM.flatMap(({ platform, donor, modelVersion }) =>
    written
      .filter((fixture) => fixture.platform === donor)
      .map((fixture) => ({
        ...fixture,
        id: fixture.id.replace(new RegExp(`^${donor}-`), `${platform}-`),
        platform,
        result: { ...fixture.result, modelVersion },
      })),
  );
}

export function fixturesForPlatform(platform: Platform): ResponseFixture[] {
  return allFixtures().filter((fixture) => fixture.platform === platform);
}
