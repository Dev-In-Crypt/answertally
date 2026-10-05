import { expect, type Page } from "@playwright/test";

/**
 * Бесплатный аудит со страницы измерения — тем же путём, что у человека.
 *
 * Без оплаты на странице измерения нет «Run now»: вход в аудит один, экран
 * аудита с шагами. После аудита возвращаемся туда, откуда пришли, — дальше
 * спеки работают со страницей измерения.
 */
export async function runFreeAudit(page: Page, timeout = 30_000): Promise<void> {
  const back = page.url();
  await page.getByRole("link", { name: "Run the free audit" }).click();
  await page.getByTestId("run-audit").click();
  await expect(page.getByTestId("audit-done")).toBeVisible({ timeout });
  await page.goto(back);
  await expect(page.getByTestId("run-status")).toContainText("done");
}
