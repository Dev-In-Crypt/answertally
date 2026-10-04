import { expect, test } from "@playwright/test";

/**
 * Verify T03: signup -> logout -> login.
 * Требует поднятой БД (docker compose up -d && pnpm db:migrate).
 */

function uniqueEmail(): string {
  const suffix = Math.random().toString(36).slice(2, 10);
  return `owner-${suffix}@northwind-agency.test`;
}

test("signup creates an agency, then logout and login work", async ({ page }) => {
  const email = uniqueEmail();
  const password = "correct-horse-battery";

  await page.goto("/signup");
  await page.getByLabel("Your name").fill("Test Owner");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Create account" }).click();

  // Регистрация = создание агентства; имя выводится из домена почты.
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator("aside")).toContainText("Northwind Agency");
  await expect(page.locator("aside")).toContainText(email);

  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login$/);

  // Сессии нет — защищённая страница возвращает на логин и помнит, куда шли.
  await page.goto("/dashboard");
  await expect(page).toHaveURL(/\/login\?next=%2Fdashboard$/);

  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator("aside")).toContainText("Northwind Agency");
});

test("login with a wrong password shows an error and does not sign in", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Work email").fill("nobody@northwind-agency.test");
  await page.getByLabel("Password").fill("definitely-wrong");
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page.getByTestId("form-error")).toBeVisible();
  await expect(page).toHaveURL(/\/login$/);
});
