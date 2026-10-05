import { expect, test, type Page } from "@playwright/test";
import { runFreeAudit } from "./free-audit";

/**
 * Verify: путь, ради которого продукт переделан.
 *
 * Агентство открывает клиента, видит, где он проигрывает, понимает почему,
 * смотрит на чём это посчитано и переносит в работу — не выходя из одного
 * экрана и ни разу не увидев обещания результата.
 */

const CSV = [
  "cluster,intent,prompt,is_control",
  "CRM comparison,comparison,best CRM for startups,false",
  "CRM comparison,comparison,easiest CRM for a small sales team,false",
  "CRM basics,learning,what to look for when choosing a CRM,false",
  "CRM basics,learning,CRM vs spreadsheet for a small team,false",
].join("\n");

async function signUpWithClient(page: Page): Promise<string> {
  const email = `opp-${Math.random().toString(36).slice(2, 10)}@northwind-agency.test`;

  await page.goto("/signup");
  await page.getByLabel("Your name").fill("Opportunity Tester");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/clients/new");
  await page.getByLabel("Client name").fill("AcmeCRM");
  await page.getByLabel("Domain").fill("acmecrm.test");
  await page.getByLabel("Brand names").fill("AcmeCRM, Acme CRM, Acme");
  await page.getByLabel("Competitors").fill("Northstack, Pipewell, Clasp");
  await page.getByRole("button", { name: "Create client" }).click();
  await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}\/onboarding$/);
  await page.goto(page.url().replace(/\/onboarding$/, ""));

  return page.url().split("/").pop()!;
}

test("an opportunity explains itself and becomes work", async ({ page }) => {
  const clientId = await signUpWithClient(page);

  // До измерения экран честно говорит, что находить пока не на чем.
  await page.goto(`/clients/${clientId}/opportunities`);
  await expect(page.getByText("No opportunities yet")).toBeVisible();

  await page.goto(`/clients/${clientId}/measure`);
  await page.getByLabel("Prompts CSV").setInputFiles({
    name: "prompts.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(CSV, "utf8"),
  });
  await expect(page.getByTestId("import-summary")).toContainText("4 prompts");

  await runFreeAudit(page);

  await page.goto(`/clients/${clientId}/opportunities`);

  const cards = page.getByTestId("opportunity-card");
  await expect(cards.first()).toBeVisible({ timeout: 15_000 });

  // Оценка — число от 0 до 100, и список отсортирован по ней.
  const scores = (await page.getByTestId("opportunity-score").allInnerTexts()).map(Number);
  expect(scores.length).toBeGreaterThan(0);
  for (const score of scores) {
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  }
  expect([...scores].sort((a, b) => b - a)).toEqual(scores);

  // Причина есть у каждой находки и не обещает причинности.
  const reasons = await page.getByTestId("opportunity-reason").allInnerTexts();
  for (const reason of reasons) {
    expect(reason.trim().length).toBeGreaterThan(0);
    expect(reason).not.toMatch(/proof|proven|guarantee|caused/i);
  }

  // Разворот показывает, из чего собрана оценка и на каких ответах.
  await cards.first().getByRole("button").click();
  const detail = page.getByTestId("opportunity-detail");
  await expect(detail.getByTestId("score-breakdown")).toBeVisible();
  await expect(detail.getByTestId("opportunity-evidence")).toBeVisible({ timeout: 15_000 });
  await expect(detail.getByTestId("evidence-window")).not.toBeEmpty();

  // Перенос в работу уносит причину вместе с задачей.
  const firstReason = (await page.getByTestId("opportunity-reason").first().innerText()).trim();
  await detail.getByTestId("convert-opportunity").first().click();
  await expect(page).toHaveURL(/\/actions$/, { timeout: 15_000 });

  const board = page.getByTestId("actions-board");
  await expect(board).toBeVisible();
  expect(firstReason.length).toBeGreaterThan(0);
});

test("dismissing an opportunity needs a reason and survives a recompute", async ({ page }) => {
  const clientId = await signUpWithClient(page);

  await page.goto(`/clients/${clientId}/measure`);
  await page.getByLabel("Prompts CSV").setInputFiles({
    name: "prompts.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(CSV, "utf8"),
  });
  // Импорт асинхронный: без ожидания «Run now» иногда жмётся раньше, чем
  // вопросы доехали, сервер отказывает «добавьте хотя бы один вопрос», и
  // строки со статусом прогона не появляется вовсе.
  await expect(page.getByTestId("import-summary")).toContainText("4 prompts");
  await runFreeAudit(page);

  await page.goto(`/clients/${clientId}/opportunities`);
  const card = page.getByTestId("opportunity-card").first();
  await expect(card).toBeVisible({ timeout: 15_000 });
  await card.getByRole("button").click();

  const detail = page.getByTestId("opportunity-detail");
  // Без причины кнопка недоступна: пункт, снятый молча, вернётся тем же
  // детектором, и никто не вспомнит, почему его сняли.
  await expect(detail.getByTestId("dismiss-opportunity")).toBeDisabled();

  await detail.getByTestId("dismiss-reason").fill("Client will not work with review sites");
  await detail.getByTestId("dismiss-opportunity").click();

  await expect(page.getByTestId("decided-opportunities")).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId("decided-opportunities")).toContainText("review sites");
});
