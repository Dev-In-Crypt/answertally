import { expect, test } from "@playwright/test";

/**
 * Verify T86: экран плана показывает текущие права и не притворяется, что
 * принимает деньги, пока провайдер не подключён.
 */

test("the plan screen states what the agency gets and what it cannot do yet", async ({ page }) => {
  const email = `billing-${Math.random().toString(36).slice(2, 10)}@northwind-agency.test`;

  await page.goto("/signup");
  await page.getByLabel("Your name").fill("Billing Tester");
  await page.getByLabel("Agency name").fill("QA Agency");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.getByRole("link", { name: "Plan" }).click();
  await expect(page).toHaveURL(/\/settings\/billing$/);

  // До всякой оплаты у нового агентства бесплатный аудит, а не тариф.
  await expect(page.getByTestId("current-plan")).toHaveText("Free audit");
  await expect(page.getByTestId("plan-reason")).toContainText("the free audit applies");

  // Оплата не подключена: ни одной кнопки, которая упадёт.
  await expect(page.getByTestId("payments-off")).toBeVisible();
  await expect(page.getByTestId("choose-growth")).toHaveCount(0);
  await expect(page.getByTestId("open-portal")).toHaveCount(0);

  // Все три плана перечислены с ценами: агентство должно видеть, куда расти.
  await expect(page.getByText("$1,299")).toBeVisible();
  await expect(page.getByText("$2,499")).toBeVisible();
});
