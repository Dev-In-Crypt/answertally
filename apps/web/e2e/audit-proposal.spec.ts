import { expect, test } from "@playwright/test";
import { PDFParse } from "pdf-parse";

/**
 * Verify T62: для prospect-клиента собирается аудит-отчёт и его white-label PDF.
 */

async function extractText(bytes: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(bytes) });
  try {
    return (await parser.getText()).text;
  } finally {
    await parser.destroy();
  }
}

test("opportunity report and its PDF are produced for a prospect", async ({ page, browser }) => {
  const email = `opp-${Math.random().toString(36).slice(2, 10)}@northwind-agency.test`;

  await page.goto("/signup");
  await page.getByLabel("Your name").fill("Opportunity Tester");
  await page.getByLabel("Agency name").fill("QA Agency");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/settings");
  await page.getByLabel("Agency name").fill("Northwind Studio");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByTestId("settings-status")).toHaveText("Saved");

  await page.goto("/clients/new");
  // Проспект, которого нет ни в одном ответе платформ, а конкуренты там есть, —
  // это и есть тот, кому аудит продаёт работу.
  await page.getByLabel("Client name").fill("Northwind CRM");
  await page.getByLabel("Domain").fill("northwind-crm.test");
  await page.getByLabel("Industry").fill("CRM software");
  await page.getByLabel("Brand names").fill("Northwind CRM, Northwind");
  await page.getByLabel("Competitors").fill("Northstack, Pipewell, Clasp");
  await page.getByLabel("Prospect (free audit)").check();
  await page.getByRole("button", { name: "Create client" }).click();
  // Заведение клиента ведёт на второй шаг онбординга, а не в список.
  await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}\/onboarding$/);
  await page.goto(page.url().replace(/\/onboarding$/, ""));
  const clientId = page.url().split("/").pop()!;

  // Промпты и аудит — теми же экранами, что у обычного пользователя.
  await page.goto(`/clients/${clientId}/measure`);
  await page.getByTestId("generate-prompts").click();
  await page.getByTestId("save-generated").click();
  await expect(page.getByTestId("generate-summary")).toContainText("Saved 16 prompts");

  await page.goto(`/clients/${clientId}/audit`);
  await page.getByTestId("run-audit").click();
  await expect(page.getByTestId("audit-done")).toBeVisible({ timeout: 120_000 });

  await page.goto(`/clients/${clientId}/reports`);

  // Маржа видна агентству до генерации: 3500 − 30×85 = 950 → 27.1%.
  await expect(page.getByTestId("opportunity-margin")).toContainText("27.1%");

  await page.getByTestId("generate-opportunity").click();
  await expect(page.getByTestId("reports-list").locator("li")).toHaveCount(1);

  await page.getByRole("button", { name: "Get client link" }).click();
  const token = (await page.getByTestId("share-link").innerText()).split("/r/").at(-1)!.trim();

  // Клиентская страница: предложение видно, внутренняя экономика — нет.
  const anonymous = await browser.newContext();
  const anonPage = await anonymous.newPage();
  await anonPage.goto(`/r/${token}`);

  await expect(anonPage.getByTestId("report-opportunity")).toBeVisible();
  await expect(anonPage.getByTestId("opportunity-retainer")).toContainText("$3,500");
  await expect(anonPage.getByTestId("opportunity-actions").locator("li").first()).toBeVisible();

  // Внутренняя экономика агентства не должна доехать до клиента ни текстом,
  // ни в данных страницы: проверяются оба.
  const visible = await anonPage.locator("body").innerText();
  expect(visible.toLowerCase()).not.toContain("margin");

  const html = await anonPage.content();
  expect(html).not.toContain("estimatedMarginPct");
  expect(html).not.toContain("27.1");
  expect(html).not.toMatch(/\bproven\b|\bproof\b|\bguaranteed\b|\bcaused\b/i);
  await anonymous.close();

  // PDF аудита: тот же документ, что видит клиент.
  const href = (await page
    .getByRole("link", { name: "Download PDF" })
    .getAttribute("href")) as string;
  const response = await page.request.get(href, { timeout: 120_000 });
  expect(response.status()).toBe(200);

  const body = await response.body();
  expect(body.byteLength).toBeGreaterThan(20_000);

  const text = await extractText(body);
  expect(text).toContain("Northwind CRM");
  expect(text).toContain("Northwind Studio");
  expect(text).toContain("Where the opportunity is");
  expect(text).toContain("$3,500");
  // Внутренние деньги в клиентский документ не попадают.
  expect(text).not.toContain("27.1");
  expect(text.toLowerCase()).not.toContain("margin");
});
