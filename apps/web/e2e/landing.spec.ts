import { expect, test } from "@playwright/test";
import { collectConsoleErrors } from "./console";

/**
 * Verify T70: лендинг показывает оффер, тарифы и живой пример отчёта,
 * а залогиненного не задерживает.
 */

test("landing gives an anonymous visitor the offer, the plans and a way in", async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page);

  await page.goto("/");

  await expect(page.getByRole("heading", { level: 1 })).toContainText("Show your clients whether it names them");

  // Главный призыв ведёт к бесплатному аудиту, то есть на регистрацию.
  await expect(page.getByTestId("landing-cta-audit")).toHaveAttribute("href", "/signup");
  await expect(page.getByRole("link", { name: "See an example report" })).toHaveAttribute(
    "href",
    "/sample-report",
  );

  // Строка метода под hero: каденс по умолчанию и ссылка на методологию.
  const method = page.getByTestId("hero-method");
  await expect(method).toContainText("every two weeks by default");
  await expect(method.getByRole("link")).toHaveAttribute("href", "/method");

  // Главное обещание показано, а не только сказано: доля с диапазоном,
  // числом ответов, уверенностью и самим ответом.
  const evidence = page.getByTestId("landing-evidence");
  await expect(evidence).toContainText("range");
  await expect(evidence).toContainText("answers");
  await expect(evidence).toContainText("confidence");

  // Три тарифа с суммами из PLAN_LIMITS — витрина и API берут их из одного места.
  await expect(page.getByTestId("pricing-plans").locator("> li")).toHaveCount(3);
  await expect(page.getByTestId("plan-price-starter")).toHaveText("$199");
  await expect(page.getByTestId("plan-price-growth")).toHaveText("$599");
  await expect(page.getByTestId("plan-price-scale")).toHaveText("$1,199");

  // Лимиты видны рядом с ценой. Объяснение allowance («950 checks») — на
  // /pricing и проверяется в marketing.spec.ts; главная ведёт туда ссылкой.
  await expect(page.getByText("3,000")).toBeVisible();
  await expect(page.getByRole("link", { name: /Full pricing and what an AI check is/ })).toHaveAttribute(
    "href",
    "/pricing",
  );

  // Отчёт на витрине — сокращённый настоящий: цифры из демонстрационного
  // отчёта и раздел оговорок, без причин под «Next sprint».
  const report = page.getByTestId("landing-report");
  await expect(report).toContainText("19.4% → 28.6%");
  await expect(report).toContainText("How to read this");
  await expect(report).toContainText("grouped by week");
  // Вклад действия показан, значит сравнивать было с чем: оговорка «не с чем»
  // рядом с ним спорила бы с методом.
  await expect(report).not.toContainText("no untouched topics");

  // Возражения — словами покупателя, включая «у нас уже есть SEO-пакет».
  await expect(page.getByTestId("landing-objections")).toContainText("Semrush");
  // Внешняя цифра о рынке — со ссылкой на источник.
  await expect(page.locator('a[href*="agencyanalytics.com"]')).toHaveCount(1);

  const html = await page.content();
  expect(html).not.toMatch(/\bproven\b|\bproof\b|\bguaranteed\b|\bcaused\b/i);

  expect(consoleErrors).toEqual([]);
});

test("the example report is a real report page in a fictional agency's brand", async ({ page }) => {
  await page.goto("/");
  await page.getByRole("link", { name: "See an example report" }).click();
  await expect(page).toHaveURL(/\/sample-report$/);

  // Образец подписан как выдуманный: иначе это фальшивый кейс.
  await expect(page.getByTestId("sample-report-notice")).toBeVisible();

  // Рендерится тот же компонент, что и клиентский отчёт.
  await expect(page.getByTestId("agency-name")).toHaveText("Harbor & Pine");
  await expect(page.getByTestId("report-visibility")).toContainText("19.4% → 28.6%");
  await expect(page.getByTestId("report-work").locator("li")).toHaveCount(5);
  await expect(page.getByTestId("report-results")).toContainText("Answers naming");
  await expect(page.getByTestId("report-caveats")).toContainText("share of AI answers");

  const html = await page.content();
  expect(html).not.toMatch(/\bproven\b|\bproof\b|\bguaranteed\b|\bcaused\b/i);
});

test("the audit example shows the ranked work without the agency's internal economics", async ({
  page,
}) => {
  await page.goto("/sample-report/audit");

  await expect(page.getByTestId("report-opportunity")).toBeVisible();
  // Только верхние пункты: внутри каждого ещё шаги «How it is done».
  await expect(page.getByTestId("opportunity-actions").locator("> li")).toHaveCount(6);
  await expect(page.getByTestId("opportunity-visibility")).toContainText("11.5%");
  await expect(page.getByTestId("opportunity-retainer")).toContainText("$3,500");

  // Маржа агентства не должна утечь даже на витрину.
  const visible = await page.locator("body").innerText();
  expect(visible.toLowerCase()).not.toContain("margin");
  expect(await page.content()).not.toContain("estimatedMarginPct");
});

test("a signed-in user can reach the landing and get back to the dashboard", async ({ page }) => {
  const email = `landing-${Math.random().toString(36).slice(2, 10)}@northwind-agency.test`;

  await page.goto("/signup");
  await page.getByLabel("Your name").fill("Landing Tester");
  await page.getByLabel("Agency name").fill("QA Agency");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  // Знак в кабинете ведёт на сайт; оттуда обратно — «Dashboard» в шапке.
  await page.goto("/");
  await expect(page).toHaveURL(/\/$/);
  const header = page.getByTestId("marketing-header");
  await expect(header.getByRole("link", { name: "Dashboard" })).toHaveAttribute("href", "/dashboard");
});
