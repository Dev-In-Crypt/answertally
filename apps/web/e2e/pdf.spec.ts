import { expect, test } from "@playwright/test";
import { PDFParse } from "pdf-parse";
import { runFreeAudit } from "./free-audit";

async function extractText(bytes: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(bytes) });
  try {
    return (await parser.getText()).text;
  } finally {
    await parser.destroy();
  }
}

/**
 * Verify T53: PDF генерируется, весит больше 20 КБ и содержит имя клиента.
 * Проверяется именно содержимое: пустой или битый PDF тоже «скачивается».
 */

const CSV = [
  "cluster,intent,prompt,is_control",
  "CRM comparison,comparison,best CRM for startups,false",
].join("\n");

test("agency downloads a PDF containing the client report", async ({ page }) => {
  const email = `pdf-${Math.random().toString(36).slice(2, 10)}@northwind-agency.test`;

  await page.goto("/signup");
  await page.getByLabel("Your name").fill("PDF Tester");
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
  await page.getByLabel("Client name").fill("AcmeCRM");
  await page.getByLabel("Domain").fill("acmecrm.test");
  await page.getByRole("button", { name: "Create client" }).click();
  // Заведение клиента ведёт на второй шаг онбординга, а не в список.
  await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}\/onboarding$/);
  await page.goto(page.url().replace(/\/onboarding$/, ""));
  const clientId = page.url().split("/").pop()!;

  await page.goto(`/clients/${clientId}/measure`);
  await page.getByLabel("Prompts CSV").setInputFiles({
    name: "prompts.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(CSV, "utf8"),
  });
  // Импорт асинхронный: без ожидания «Run now» иногда жмётся раньше, чем
  // промпты доедут до списка, и прогон отказывается стартовать.
  await expect(page.getByText(/Imported \d+ prompts/)).toBeVisible();
  await runFreeAudit(page);

  await page.goto(`/clients/${clientId}/reports`);
  await page.getByTestId("generate-report").click();
  await expect(page.getByTestId("reports-list").locator("li")).toHaveCount(1);

  // Скачиваем через сессию агентства: у запроса есть куки авторизации.
  const pdfLink = page.getByRole("link", { name: "Download PDF" });
  const href = await pdfLink.getAttribute("href");
  const response = await page.request.get(href!, { timeout: 120_000 });

  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("application/pdf");

  const body = await response.body();
  expect(body.byteLength).toBeGreaterThan(20_000);

  const text = await extractText(body);
  // Содержимое, а не просто «файл скачался».
  expect(text).toContain("AcmeCRM");
  expect(text).toContain("Northwind Studio");
  expect(text).toContain("AI answer visibility");
  // Инвариант 2 держится и в печатной версии.
  expect(text).not.toMatch(/\bproven\b|\bproof\b|\bguaranteed\b|\bcaused\b/i);
});

test("PDF of another agency's report is not reachable", async ({ page, browser }) => {
  const email = `pdf-owner-${Math.random().toString(36).slice(2, 10)}@northwind-agency.test`;

  await page.goto("/signup");
  await page.getByLabel("Your name").fill("Owner");
  await page.getByLabel("Agency name").fill("QA Agency");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/clients/new");
  await page.getByLabel("Client name").fill("Secret Client");
  await page.getByLabel("Domain").fill("secret.test");
  await page.getByRole("button", { name: "Create client" }).click();
  // Заведение клиента ведёт на второй шаг онбординга, а не в список.
  await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}\/onboarding$/);
  await page.goto(page.url().replace(/\/onboarding$/, ""));
  const clientId = page.url().split("/").pop()!;

  // Отчёт без единого замера не собирается: нужен хотя бы один прогон.
  await page.goto(`/clients/${clientId}/measure`);
  await page.getByLabel("Prompts CSV").setInputFiles({
    name: "prompts.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(CSV, "utf8"),
  });
  await expect(page.getByText(/Imported \d+ prompts/)).toBeVisible();
  await runFreeAudit(page);

  await page.goto(`/clients/${clientId}/reports`);
  await page.getByTestId("generate-report").click();
  await expect(page.getByTestId("reports-list").locator("li")).toHaveCount(1);
  const href = (await page
    .getByRole("link", { name: "Download PDF" })
    .getAttribute("href")) as string;

  // Другое агентство по прямой ссылке получает 404, а не чужой документ.
  const other = await browser.newContext();
  const otherPage = await other.newPage();
  const otherEmail = `pdf-other-${Math.random().toString(36).slice(2, 10)}@northwind-agency.test`;

  await otherPage.goto("/signup");
  await otherPage.getByLabel("Your name").fill("Other");
  await otherPage.getByLabel("Agency name").fill("QA Agency");
  await otherPage.getByLabel("Work email").fill(otherEmail);
  await otherPage.getByLabel("Password").fill("correct-horse-battery");
  await otherPage.getByRole("button", { name: "Create account" }).click();
  await expect(otherPage).toHaveURL(/\/dashboard$/);

  const response = await otherPage.request.get(href);
  expect(response.status()).toBe(404);

  await other.close();
});
