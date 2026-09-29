import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createAgency,
  createClient,
  createDb,
  createReport,
  createReportShare,
  deleteAgency,
  updateAgency,
} from "@repo/db";

/**
 * Инвариант 3 на уровне разметки: страница, которую агентство отдаёт своему
 * клиенту, не должна содержать ни следа стороннего поставщика.
 *
 * Сквозной тест (T51) проверяет то же самое в браузере, но он гоняется только
 * на объединённой ветке и требует поднятого приложения. Здесь та же проверка
 * стоит рядом с кодом и падает на первом же запуске тестов — потому что
 * утечка бренда чинится правкой в одну строку, а замечается через недели.
 *
 * Форма клиента заменена заглушкой: это client-компонент, ему нужны роутер и
 * tRPC-провайдер, которых при отрисовке в тесте нет. На брендинг она не
 * влияет — своего текста у неё нет.
 */
vi.mock("./[token]/approve-form", () => ({ ApproveForm: () => null }));

/**
 * JSX здесь собирает esbuild из vitest, а не компилятор Next: в tsconfig стоит
 * `jsx: "preserve"`, потому что преобразование — работа Next. esbuild в таком
 * случае зовёт `React.createElement`, а импорта React в страницах нет — его
 * добавляет Next. Кладём React в глобальную область, чтобы вызов нашёлся.
 */
(globalThis as { React?: typeof React }).React = React;

/**
 * Имя продукта во всех написаниях, его знак и его домен. При переименовании
 * продукта список обязан обновиться: иначе проверка продолжит искать строку,
 * которой больше нет, и пройдёт на любой разметке.
 */
const VENDOR_TRACES = [
  "Answertally",
  "answertally",
  // Знак продукта из apps/web/src/app/icon.svg: индиговая плитка.
  "#4F39F6",
  "#4f39f6",
] as const;

/** Домен продукта в тестах: отличается от домена агентства, чтобы утечку было видно. */
const PRODUCT_ORIGIN = "https://app.vendor-product.test";
const AGENCY_REPORT_HOST = "reports.northwind-studio.test";

const AGENCY_NAME = "Northwind Studio";
const AGENCY_COLOR = "#0ea5e9";

const PAYLOAD = {
  client: { name: "AcmeCRM" },
  period: { start: "2026-08-03", end: "2026-08-31" },
  visibility: { before: 23, after: 31 },
  competitorGap: { before: -14, after: -6 },
  workCompleted: [{ label: "Comparison pages published", count: 3 }],
  results: { newCitedUrls: 2, newBrandMentions: 5, visibilityDeltaPp: 8 },
  highestImpactAction: null,
  nextSprint: ["Refresh the pricing page"],
  caveats: ["Numbers are an estimate of share of AI answers, not traffic."],
};

const { db, close } = createDb();

afterAll(async () => {
  await close();
});

let agencyId = "";
let token = "";

beforeEach(async () => {
  const agency = await createAgency(db, { name: AGENCY_NAME, clientLimit: 10 });
  agencyId = agency.id;
  await updateAgency(db, agencyId, { brandColor: AGENCY_COLOR });

  const client = await createClient(db, {
    agencyId,
    name: "AcmeCRM",
    domain: "acmecrm.test",
    competitorNames: ["Northstack"],
  });

  const report = await createReport(db, {
    clientId: client.id,
    periodStart: new Date("2026-08-03T00:00:00Z"),
    periodEnd: new Date("2026-08-31T00:00:00Z"),
    payload: PAYLOAD,
  });

  token = `wl-${Math.random().toString(36).slice(2, 12)}`;
  await createReportShare(db, { reportId: report.id, token });
});

afterEach(async () => {
  await deleteAgency(db, agencyId);
  vi.unstubAllEnvs();
  vi.resetModules();
});

/** Модули перечитываются после подмены переменных: REPORT_HOST — константа модуля. */
async function loadPage() {
  vi.resetModules();
  return import("./[token]/page");
}

async function renderReport(): Promise<string> {
  const { default: PublicReportPage } = await loadPage();
  const element = await PublicReportPage({ params: Promise.resolve({ token }) });
  return renderToStaticMarkup(element);
}

describe("клиентский отчёт на домене агентства", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", PRODUCT_ORIGIN);
    vi.stubEnv("NEXT_PUBLIC_REPORT_HOST", AGENCY_REPORT_HOST);
  });

  it("ссылка для клиента ведёт на домен агентства", async () => {
    vi.resetModules();
    const { reportUrl } = await import("./report-url");
    expect(reportUrl(token)).toBe(`https://${AGENCY_REPORT_HOST}/r/${token}`);
  });

  it("в разметке отчёта нет ни имени продукта, ни его знака, ни его домена", async () => {
    const html = await renderReport();

    // Бренд агентства на месте — иначе проверка «ничего нет» прошла бы и на пустой странице.
    expect(html).toContain(AGENCY_NAME);
    expect(html).toContain(AGENCY_COLOR);

    for (const trace of VENDOR_TRACES) {
      expect(html).not.toContain(trace);
    }
    expect(html).not.toContain("vendor-product.test");
  });

  it("на странице нет ни одной ссылки наружу и ни одного скрипта", async () => {
    const html = await renderReport();

    // Ссылка назад к нам — самый простой способ выдать поставщика.
    const externalLinks = html.match(/href="https?:\/\/[^"]*"/g) ?? [];
    expect(externalLinks).toEqual([]);

    // Аналитика продукта на странице клиента агентства недопустима.
    expect(html).not.toMatch(/<script/i);
  });

  it("canonical и превью ссылки указывают на домен агентства", async () => {
    const { generateMetadata } = await loadPage();
    const metadata = await generateMetadata({ params: Promise.resolve({ token }) });

    const expected = `https://${AGENCY_REPORT_HOST}/r/${token}`;
    expect(metadata.alternates?.canonical).toBe(expected);
    expect(metadata.openGraph?.url).toBe(expected);

    // Ни имени продукта, ни его сайта в метаданных — и страница закрыта от поиска.
    const serialized = JSON.stringify(metadata);
    for (const trace of VENDOR_TRACES) {
      expect(serialized).not.toContain(trace);
    }
    expect(serialized).not.toContain("vendor-product.test");
    expect(metadata.robots).toMatchObject({ index: false });
  });

  it("иконка вкладки — плитка агентства, а не знак продукта", async () => {
    vi.resetModules();
    const { default: Icon } = await import("./[token]/icon");
    const response = await Icon({ params: Promise.resolve({ token }) });
    const svg = await response.text();

    expect(response.headers.get("content-type")).toBe("image/svg+xml");
    expect(svg).toContain(AGENCY_COLOR);
    // Первая буква названия агентства.
    expect(svg).toContain(">N<");
    for (const trace of VENDOR_TRACES) {
      expect(svg).not.toContain(trace);
    }
  });
});

describe("без NEXT_PUBLIC_REPORT_HOST", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", PRODUCT_ORIGIN);
    vi.stubEnv("NEXT_PUBLIC_REPORT_HOST", "");
  });

  it("отчёт открывается и остаётся в бренде агентства", async () => {
    const html = await renderReport();
    expect(html).toContain(AGENCY_NAME);
    for (const trace of VENDOR_TRACES) {
      expect(html).not.toContain(trace);
    }
  });

  it("ссылка строится на адресе продукта, а не ломается", async () => {
    vi.resetModules();
    const { reportUrl } = await import("./report-url");
    expect(reportUrl(token)).toBe(`${PRODUCT_ORIGIN}/r/${token}`);

    const { generateMetadata } = await loadPage();
    const metadata = await generateMetadata({ params: Promise.resolve({ token }) });
    expect(metadata.alternates?.canonical).toBe(`${PRODUCT_ORIGIN}/r/${token}`);
  });
});

describe("недействительная ссылка", () => {
  it("говорит об этом и не показывает бренд продукта", async () => {
    vi.stubEnv("NEXT_PUBLIC_REPORT_HOST", AGENCY_REPORT_HOST);
    const { default: PublicReportPage } = await loadPage();
    const element = await PublicReportPage({
      params: Promise.resolve({ token: "definitely-not-a-real-token" }),
    });
    const html = renderToStaticMarkup(element);

    expect(html).toContain("no longer valid");
    for (const trace of VENDOR_TRACES) {
      expect(html).not.toContain(trace);
    }
  });
});
