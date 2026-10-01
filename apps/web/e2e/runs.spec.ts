import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/** Verify T22: «Run now» в mock-режиме доходит до done, прогон виден в истории. */

const CSV = [
  "cluster,intent,prompt,is_control",
  "CRM comparison,comparison,best CRM for startups,false",
  "CRM comparison,comparison,Northstack alternatives,false",
].join("\n");

async function setUpClientWithPrompts(page: Page): Promise<string> {
  const email = `runs-${Math.random().toString(36).slice(2, 10)}@northwind-agency.test`;

  await page.goto("/signup");
  await page.getByLabel("Your name").fill("Runs Tester");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/clients/new");
  await page.getByLabel("Client name").fill("AcmeCRM");
  await page.getByLabel("Domain").fill("acmecrm.test");
  await page.getByLabel("Brand names").fill("AcmeCRM, Acme CRM");
  await page.getByLabel("Competitors").fill("Northstack, Pipewell");
  await page.getByRole("button", { name: "Create client" }).click();
  // Заведение клиента ведёт на второй шаг онбординга, а не в список.
  await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}\/onboarding$/);
  await page.goto("/clients");

  await page.getByRole("link", { name: /AcmeCRM/ }).click();
  await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}$/);
  const clientId = page.url().split("/").pop()!;

  await page.goto(`/clients/${clientId}/measure`);
  await page.getByLabel("Prompts CSV").setInputFiles({
    name: "prompts.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(CSV, "utf8"),
  });
  await expect(page.getByTestId("import-summary")).toContainText("2 prompts");

  return clientId;
}

test("saving a schedule and running a check produces a completed run", async ({ page }) => {
  const clientId = await setUpClientWithPrompts(page);
  await page.goto(`/clients/${clientId}/measure`);

  await page.getByLabel("Samples per prompt").fill("3");
  await page.getByRole("button", { name: "Save schedule" }).click();
  await expect(page.getByTestId("schedule-summary")).toContainText("3 samples per prompt");
  await expect(page.getByTestId("schedule-summary")).toContainText("chatgpt");

  await page.getByRole("button", { name: "Run now" }).click();

  // Главная проверка: прогон действительно доходит до конца.
  await expect(page.getByTestId("run-status")).toContainText("done", { timeout: 30_000 });

  const history = page.getByTestId("runs-list");
  await expect(history).toContainText("manual");
  await expect(history).toContainText("done");

  // История переживает перезагрузку — прогон записан, а не показан оптимистично.
  await page.reload();
  await expect(page.getByTestId("runs-list")).toContainText("done");
});

test("the plan decides what is offered, and locked assistants are visible", async ({ page }) => {
  const clientId = await setUpClientWithPrompts(page);
  await page.goto(`/clients/${clientId}/measure`);

  // Агентство только зарегистрировалось и ещё не платило — это бесплатный
  // аудит. Форма предлагает ровно то, что он покрывает, и заранее отмеченным
  // не оказывается ассистент, которого сохранить нельзя.
  await expect(page.getByLabel("ChatGPT")).toBeChecked();
  await expect(page.getByLabel("Perplexity")).toBeChecked();

  // Запертое видно, а не спрятано, и подписано тарифом, на котором включается.
  await expect(page.getByLabel("Claude")).not.toBeChecked();
  await expect(page.getByLabel("Claude")).toBeDisabled();
  await expect(page.getByTestId("assistant-locked-claude")).toContainText("growth");

  /**
   * Grok заперт до оплаты, а не по тарифу: он стоит дороже всех ($0.1058 за
   * ответ против $0.0014 у Perplexity), и бесплатный аудит его не включает.
   * Виден он при этом так же, как Claude, — выключенным и с подписью, а не
   * спрятанным.
   */
  await expect(page.getByLabel("Grok")).not.toBeChecked();
  await expect(page.getByLabel("Grok")).toBeDisabled();
  await expect(page.getByTestId("assistant-locked-grok")).toBeVisible();

  // Умолчание сохраняется без отказа.
  await page.getByRole("button", { name: "Save schedule" }).click();
  await expect(page.getByTestId("schedule-summary")).toContainText("chatgpt");
  await expect(page.getByTestId("schedule-summary")).not.toContainText("grok");
  await expect(page.getByTestId("form-error")).toHaveCount(0);

  // Снятое остаётся снятым: форма показывает сохранённое, а не умолчания —
  // иначе следующее «Save» молча вернуло бы выключенное.
  await page.getByLabel("Perplexity").uncheck();
  await page.getByRole("button", { name: "Save schedule" }).click();
  await expect(page.getByTestId("schedule-summary")).not.toContainText("perplexity");

  await page.reload();
  await expect(page.getByLabel("Perplexity")).not.toBeChecked();
  await expect(page.getByLabel("ChatGPT")).toBeChecked();

  await page.getByRole("button", { name: "Run now" }).click();
  await expect(page.getByTestId("run-status")).toContainText("done", { timeout: 30_000 });

  // Claude измеряем — у него есть API, он просто не куплен. В заметке
  // «не измеряем» остаются только те, у кого API нет вовсе.
  await page.goto(`/clients/${clientId}`);
  const note = page.getByTestId("unmeasured-note");
  await expect(note).toContainText("Copilot");
  await expect(note).not.toContainText("Claude");
  await expect(note).not.toContainText("Grok");
});

test("running a check without prompts explains what to do", async ({ page }) => {
  const email = `runs-empty-${Math.random().toString(36).slice(2, 10)}@northwind-agency.test`;

  await page.goto("/signup");
  await page.getByLabel("Your name").fill("Empty Tester");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/clients/new");
  await page.getByLabel("Client name").fill("No Prompts");
  await page.getByLabel("Domain").fill("noprompts.test");
  await page.getByRole("button", { name: "Create client" }).click();
  // Заведение клиента ведёт на второй шаг онбординга, а не в список.
  await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}\/onboarding$/);
  await page.goto(page.url().replace(/\/onboarding$/, ""));
  const clientId = page.url().split("/").pop()!;

  await page.goto(`/clients/${clientId}/measure`);
  await page.getByRole("button", { name: "Run now" }).click();

  // Пустой прогон не создаётся: он стоил бы денег и дал бы пустое окно измерения.
  await expect(page.getByTestId("form-error")).toContainText("at least one prompt");
});
