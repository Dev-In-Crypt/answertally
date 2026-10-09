import { expect, test } from "@playwright/test";
import { PLAN_LIMITS } from "../../../packages/core/src/billing/period";
import {
  VOLUME_ACCOUNT_PRICE_USD,
  VOLUME_DISCOUNT,
  VOLUME_THRESHOLD,
} from "../../../packages/core/src/billing/partner";
import { SAMPLE_CONFIDENCE_THRESHOLDS } from "../../../packages/core/src/metrics/confidence";
import { collectConsoleErrors } from "./console";

/**
 * Витрина: /, /product, /method, /pricing, /free-audit.
 *
 * Страницы публичные, у каждой свой h1 и заголовок вкладки, шапка ведёт куда
 * обещает, цены и цена за клиента равны PLAN_LIMITS, калькулятор считает на
 * числах агентства, карточка отчёта в бренде агентства не несёт ничего
 * нашего и не показывает того, чего нет в настоящем отчёте, а на 375px
 * страница не уезжает вбок.
 */

const PAGES = [
  { path: "/", h1: /Buyers ask ChatGPT/, title: /Answertally/ },
  { path: "/product", h1: /From the answers assistants give/, title: /AI Visibility Platform for Agencies · Answertally/ },
  { path: "/method", h1: /How we measure/, title: /How We Measure AI Visibility · Answertally/ },
  { path: "/pricing", h1: /Priced per client/, title: /Pricing: AI Visibility Tracking per Client · Answertally/ },
  { path: "/free-audit", h1: /Audit a client, or a prospect you are pitching/, title: /Free AI Visibility Audit for Your Client · Answertally/ },
] as const;

const usd = (value: number) => `$${value.toLocaleString("en-US")}`;

test("every marketing page renders for an anonymous visitor with its own title", async ({ page }) => {
  const errors = collectConsoleErrors(page);

  for (const entry of PAGES) {
    const response = await page.goto(entry.path);
    expect(response?.ok(), `${entry.path} did not load`).toBe(true);
    // Публичная страница не уводит на логин.
    await expect(page).toHaveURL(new RegExp(`${entry.path === "/" ? "/" : entry.path}$`));
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(entry.h1);
    await expect(page).toHaveTitle(entry.title);
    expect(await page.locator('meta[name="description"]').getAttribute("content")).toBeTruthy();

    const html = await page.content();
    expect(html).not.toMatch(/\bproven\b|\bproof\b|\bguaranteed\b|\bcaused\b/i);
    // Метода «сравнение с базовой линией платформы» в продукте нет — на сайте его тоже нет.
    expect(html.toLowerCase()).not.toContain("platform baseline");
    // Недель на переобход расчёт эксперимента не пропускает.
    expect(html).not.toContain("left out while models re-crawl");
    // Не измеряемые поверхности не выдаются за измеряемые.
    expect(html).not.toMatch(/measures? (Microsoft )?Copilot/i);
    // Ни позиции, ни «первого места» в ассистенте витрина не обещает.
    expect(html).not.toMatch(/rank #?1\b|#1 in ChatGPT/i);

    // Звонок не обещается, пока контакта нет.
    if ((await page.getByTestId("sales-contact").count()) === 0) {
      expect(await page.locator("body").innerText()).not.toMatch(/talk to the founder/i);
    }
  }

  expect(errors).toEqual([]);
});

test("the header takes a visitor to each marketing page", async ({ page }) => {
  await page.goto("/pricing");
  const nav = page.getByRole("navigation", { name: "Main", exact: true });

  const targets = [
    { name: "Product", url: /\/product$/ },
    { name: "Method", url: /\/method$/ },
    { name: "Sample report", url: /\/sample-report$/ },
    { name: "Pricing", url: /\/pricing$/ },
    { name: "Free audit", url: /\/free-audit$/ },
  ];
  for (const target of targets) {
    await nav.getByRole("link", { name: target.name, exact: true }).click();
    await expect(page).toHaveURL(target.url);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  }

  // Текущий раздел подсвечен.
  await expect(nav.getByRole("link", { name: "Free audit", exact: true })).toHaveAttribute(
    "aria-current",
    "page",
  );

  const header = page.getByTestId("marketing-header");
  await expect(header.getByRole("link", { name: "Sign in" })).toHaveAttribute("href", "/login");
  await expect(page.getByTestId("header-cta")).toHaveAttribute("href", "/signup");
  await expect(page.getByTestId("header-cta")).toContainText("Run a free audit");

  // Методология доступна и из подвала.
  await expect(page.locator("footer").getByRole("link", { name: "How we measure" })).toHaveAttribute(
    "href",
    "/method",
  );

  await header.getByRole("link", { name: "Answertally home" }).click();
  await expect(page).toHaveURL(/\/$/);
});

test("the mobile menu works at 375px", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/");

  // Полная навигация спрятана, вместо неё — меню.
  await expect(page.getByRole("navigation", { name: "Main", exact: true })).toBeHidden();
  await page.getByTestId("mobile-menu").locator("summary").click();

  const compact = page.getByRole("navigation", { name: "Main, compact" });
  await expect(compact.getByRole("link", { name: "Sign in" })).toBeVisible();
  await expect(compact.getByRole("link", { name: "Method" })).toBeVisible();
  await compact.getByRole("link", { name: "Pricing" }).click();
  await expect(page).toHaveURL(/\/pricing$/);
});

test("pricing figures are the ones the API enforces", async ({ page }) => {
  await page.goto("/pricing");

  const plans = page.getByTestId("pricing-plans");
  await expect(plans.locator("> li")).toHaveCount(3);

  for (const id of ["starter", "growth", "scale"] as const) {
    const limits = PLAN_LIMITS[id];
    await expect(page.getByTestId(`plan-price-${id}`)).toHaveText(usd(limits.priceUsd));
    await expect(page.getByTestId(`plan-clients-${id}`)).toHaveText(`up to ${limits.clientLimit}`);
    await expect(page.getByTestId(`plan-checks-${id}`)).toHaveText(
      limits.aiCheckAllowance.toLocaleString("en-US"),
    );
    // Цена за клиента посчитана из тех же лимитов, а не вписана.
    await expect(page.getByTestId(`plan-per-client-${id}`)).toHaveText(
      usd(Math.round(limits.priceUsd / limits.clientLimit)),
    );
  }

  // Allowance объяснён: сколько проверок съедает обычный клиент — и при
  // каденсе по умолчанию, и при еженедельном.
  await expect(page.getByTestId("pricing-checks")).toContainText("every two weeks");
  await expect(page.getByTestId("pricing-checks")).toContainText("950 checks");
  // Утверждённые условия сказаны; неутверждённые — нет.
  const faq = page.getByTestId("pricing-faq");
  await expect(faq).toContainText("no separate price");
  await expect(faq).toContainText("not counted");
  await expect(faq).toContainText("moving to the next plan");
  await expect(faq).toContainText("Keep your SEO suite");
  // Не утверждено: входит ли API в каждый план и считается ли проспект в лимит.
  const text = await page.locator("main").innerText();
  expect(text).not.toMatch(/\bAPI\b/i);
  expect(text).not.toMatch(/\bprospect/i);
  // Предупреждения о перерасходе в продукте нет — и на странице его не обещают.
  expect(text).not.toMatch(/you get a warning/i);

  /**
   * Оптовая цена напечатана и совпадает с той, по которой считает биллинг.
   *
   * Это обещание покупателю, а не украшение страницы: число, набранное в
   * тексте руками, однажды разойдётся с тем, по которому выставлен счёт.
   */
  const volume = page.getByTestId("volume-rate");
  await expect(volume).toContainText(usd(VOLUME_ACCOUNT_PRICE_USD));
  await expect(volume).toContainText(`${VOLUME_THRESHOLD} accounts`);
  await expect(volume).toContainText(`${Math.round(VOLUME_DISCOUNT * 100)}%`);

  // Тот же источник цен на главной.
  await page.goto("/");
  for (const id of ["starter", "growth", "scale"] as const) {
    await expect(page.getByTestId(`plan-price-${id}`)).toHaveText(usd(PLAN_LIMITS[id].priceUsd));
  }
});

test("the resale calculator works on the agency's own numbers", async ({ page }) => {
  await page.goto("/pricing");

  const calc = page.getByTestId("resale-calculator");
  await expect(calc).toBeVisible();
  // Значения по умолчанию подписаны как условные.
  await expect(calc).toContainText(/illustrative/i);
  await expect(calc).toContainText("not a forecast");

  await page.getByTestId("calc-price").fill("1500");
  await page.getByTestId("calc-clients").fill("10");
  await expect(page.getByTestId("calc-revenue")).toHaveText("$15,000");

  // Самый маленький план, в который помещаются 10 клиентов.
  const fitting = (["starter", "growth", "scale"] as const)
    .map((id) => PLAN_LIMITS[id])
    .filter((limits) => limits.clientLimit >= 10)
    .sort((a, b) => a.clientLimit - b.clientLimit)[0]!;
  await expect(page.getByTestId("calc-plan")).toContainText(usd(fitting.priceUsd));

  // Маржу калькулятор не обещает.
  expect((await calc.innerText()).toLowerCase()).not.toContain("margin");
});

test("the method page states its thresholds and what it never claims", async ({ page }) => {
  await page.goto("/method");

  // Пороги уверенности — те же, что в продукте.
  const table = page.getByTestId("method-confidence");
  await expect(table.locator("tbody tr")).toHaveCount(3);
  await expect(table).toContainText(`fewer than ${SAMPLE_CONFIDENCE_THRESHOLDS.medium}`);
  await expect(table).toContainText(`${SAMPLE_CONFIDENCE_THRESHOLDS.high} or more`);

  // Исследование, на которое опирается отказ от «позиции», — со ссылкой.
  await expect(page.locator('a[href*="sparktoro.com"]')).toHaveCount(1);

  // Кого не измеряем — сказано.
  const assistants = page.getByTestId("method-assistants");
  await expect(assistants).toContainText("Copilot");
  await expect(assistants).toContainText("AI Overviews");
  await expect(assistants).toContainText("no API");

  await expect(page.getByTestId("method-never").locator("li")).not.toHaveCount(0);
  await expect(page.getByTestId("method-summary")).toContainText("every 2 weeks");
});

test("the white-label card switches agency and carries nothing of ours", async ({ page }) => {
  await page.goto("/");

  const card = page.getByTestId("landing-report");
  const agency = page.getByTestId("landing-report-agency");
  await expect(agency).toHaveText("Northwind Studio");
  const before = await card.evaluate((el) => getComputedStyle(el).getPropertyValue("--agency").trim());

  await page.getByRole("button", { name: "Harbor & Pine" }).click();
  await expect(agency).toHaveText("Harbor & Pine");
  await expect(page.getByRole("button", { name: "Harbor & Pine" })).toHaveAttribute("aria-pressed", "true");
  const after = await card.evaluate((el) => getComputedStyle(el).getPropertyValue("--agency").trim());
  expect(after).not.toBe(before);

  // Ни имени продукта, ни нашего индиго внутри карточки.
  for (const path of ["/", "/product", "/free-audit"]) {
    await page.goto(path);
    const cards = page.locator('article[data-testid$="-report"]');
    await expect(cards).toHaveCount(1);
    const inner = await cards.first().evaluate((el) => el.innerHTML.toLowerCase());
    expect(inner).not.toContain("answertally");
    expect(inner).not.toContain("#4f39f6");
    expect(inner).not.toContain("79, 57, 246");
    // Сокращённый отчёт, а не выдуманный: у настоящего раздел оговорок есть всегда.
    await expect(cards.first()).toContainText("How to read this");
  }

  // В настоящем квартальном отчёте под «Next sprint» причин нет — нет их и в карточке.
  for (const path of ["/", "/product"]) {
    await page.goto(path);
    expect(await page.locator('article[data-testid$="-report"]').innerText()).not.toContain("Reason");
  }
});

test("no marketing page scrolls sideways at 375px", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });

  for (const entry of PAGES) {
    await page.goto(entry.path);
    const overflow = await page.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(overflow.scroll, `${entry.path} scrolls sideways`).toBeLessThanOrEqual(overflow.client);
  }
});

test("a support address is visible in the footer and on the legal pages", async ({ page }) => {
  // Платёжный провайдер проверяет, что почта поддержки видна на сайте.
  await page.goto("/");
  await expect(page.getByTestId("support-email")).toHaveText("support@answertally.com");

  await page.goto("/legal/terms");
  await expect(page.getByText("support@answertally.com").first()).toBeVisible();
});
