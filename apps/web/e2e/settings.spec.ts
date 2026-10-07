import { expect, test } from "@playwright/test";

/**
 * Verify T06: загрузка логотипа и смена цвета сохраняются и переживают reload.
 */

// Минимальный валидный PNG 1x1.
const PNG_1X1 = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);

test("agency branding and team invite persist across reload", async ({ page }) => {
  const email = `settings-${Math.random().toString(36).slice(2, 10)}@northwind-agency.test`;

  await page.goto("/signup");
  await page.getByLabel("Your name").fill("Settings Tester");
  await page.getByLabel("Agency name").fill("QA Agency");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/settings");

  // Название и цвет.
  const nameInput = page.getByLabel("Agency name");
  await nameInput.fill("Renamed Agency");
  await page.getByLabel("Brand color").fill("#0ea5e9");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByTestId("settings-status")).toHaveText("Saved");

  // Логотип.
  await page.getByLabel("Logo file").setInputFiles({
    name: "logo.png",
    mimeType: "image/png",
    buffer: PNG_1X1,
  });
  await expect(page.getByTestId("agency-logo")).toBeVisible();

  // Главная проверка: переживает перезагрузку.
  await page.reload();
  await expect(page.getByLabel("Agency name")).toHaveValue("Renamed Agency");
  await expect(page.getByTestId("brand-color-value")).toHaveText("#0ea5e9");

  const logo = page.getByTestId("agency-logo");
  await expect(logo).toBeVisible();
  const logoSrc = await logo.getAttribute("src");
  expect(logoSrc).toContain("/api/files/agencies/");

  // Файл реально отдаётся хранилищем.
  const response = await page.request.get(logoSrc!);
  expect(response.status()).toBe(200);
  expect(response.headers()["content-type"]).toContain("image/png");

  // Переименование видно в сайдбаре — оно же уйдёт в white-label отчёты.
  await expect(page.locator("aside")).toContainText("Renamed Agency");

  // Приглашение участника.
  await page.getByLabel("Invite a teammate").fill("teammate@northwind-agency.test");
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByTestId("invite-link")).toContainText("/invite/");
});

test("rejects a non-image upload with a readable error", async ({ page }) => {
  const email = `settings-bad-${Math.random().toString(36).slice(2, 10)}@northwind-agency.test`;

  await page.goto("/signup");
  await page.getByLabel("Your name").fill("Bad Upload");
  await page.getByLabel("Agency name").fill("QA Agency");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/settings");
  await page.getByLabel("Logo file").setInputFiles({
    name: "not-an-image.pdf",
    mimeType: "application/pdf",
    buffer: Buffer.from("%PDF-1.4 fake"),
  });

  await expect(page.getByTestId("form-error")).toContainText("PNG");
});
