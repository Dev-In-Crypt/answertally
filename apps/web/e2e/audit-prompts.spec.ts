import { expect, test } from "@playwright/test";

/**
 * Verify T60: генерация промптов для prospect-клиента, правка списка,
 * сохранение в кластера.
 */

test("prospect client gets generated prompts, edited before saving", async ({ page }) => {
  const email = `audit-${Math.random().toString(36).slice(2, 10)}@northwind-agency.test`;

  await page.goto("/signup");
  await page.getByLabel("Your name").fill("Audit Tester");
  await page.getByLabel("Agency name").fill("QA Agency");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/clients/new");
  await page.getByLabel("Client name").fill("AcmeCRM");
  await page.getByLabel("Domain").fill("acmecrm.test");
  await page.getByLabel("Industry").fill("CRM software");
  await page.getByLabel("Brand names").fill("AcmeCRM, Acme");
  await page.getByLabel("Competitors").fill("Northstack, Pipewell");
  await page.getByLabel("Prospect (free audit)").check();
  await page.getByRole("button", { name: "Create client" }).click();
  // Заведение клиента ведёт на второй шаг онбординга, а не в список.
  await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}\/onboarding$/);

  // Пометка видна в списке — аудит не путается с платящим клиентом.
  await page.goto("/clients");
  await expect(page.getByTestId("prospect-badge")).toBeVisible();

  await page.getByRole("link", { name: /AcmeCRM/ }).click();
  await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}$/);
  const clientId = page.url().split("/").pop()!;

  await page.goto(`/clients/${clientId}/measure`);
  await page.getByTestId("generate-prompts").click();

  const draft = page.getByTestId("prompt-draft").locator("li");
  await expect(draft).toHaveCount(24);
  // Ничего ещё не сохранено: черновик живёт только на странице.
  await expect(page.getByTestId("clusters-list")).toHaveCount(0);

  // Правка: одна строка переписана, одна удалена.
  // exact: иначе «Prompt 1» совпадает ещё и с «Prompt 10»…«Prompt 19».
  await page.getByLabel("Prompt 1", { exact: true }).fill("best CRM for a two-person team");
  await page.getByRole("button", { name: "Remove prompt 2", exact: true }).click();
  await expect(draft).toHaveCount(23);

  await page.getByTestId("save-generated").click();
  await expect(page.getByTestId("generate-summary")).toContainText("Saved 23 prompts");

  // Промпты действительно легли в кластера и видны на экране измерения.
  const clusters = page.getByTestId("clusters-list").locator("> li");
  await expect(clusters).toHaveCount(4);
  await expect(page.getByTestId("clusters-list")).toContainText("best CRM for a two-person team");
  await expect(page.getByTestId("clusters-list")).toContainText("Control (untouched)");
  await expect(page.getByTestId("control-badge").first()).toBeVisible();

  // Перезагрузка: сохранённое пережило страницу, черновика больше нет.
  await page.reload();
  await expect(page.getByTestId("clusters-list").locator("> li")).toHaveCount(4);
  await expect(page.getByTestId("prompt-draft")).toHaveCount(0);
});
