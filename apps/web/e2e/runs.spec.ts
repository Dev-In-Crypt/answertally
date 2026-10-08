import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { makeAgencyPaying } from "./paid-plan";
import { runFreeAudit } from "./free-audit";

/** Verify T22: «Run now» в mock-режиме доходит до done, прогон виден в истории. */

const CSV = [
  "cluster,intent,prompt,is_control",
  "CRM comparison,comparison,best CRM for startups,false",
  "CRM comparison,comparison,Northstack alternatives,false",
].join("\n");

async function setUpClientWithPrompts(page: Page): Promise<{ clientId: string; email: string }> {
  const email = `runs-${Math.random().toString(36).slice(2, 10)}@northwind-agency.test`;

  await page.goto("/signup");
  await page.getByLabel("Your name").fill("Runs Tester");
  await page.getByLabel("Agency name").fill("QA Agency");
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

  return { clientId, email };
}

test("saving a schedule and running a check produces a completed run", async ({ page }) => {
  const { clientId, email } = await setUpClientWithPrompts(page);
  // Расписание сохраняется только у платящего агентства.
  await makeAgencyPaying(email);
  await page.goto(`/clients/${clientId}/measure`);

  await page.getByLabel("Samples per prompt").fill("3");
  await page.getByRole("button", { name: "Save schedule" }).click();
  await expect(page.getByTestId("schedule-summary")).toContainText("3 samples per prompt");
  await expect(page.getByTestId("schedule-summary")).toContainText("ChatGPT");

  await page.getByRole("button", { name: "Run now" }).click();

  // Главная проверка: прогон действительно доходит до конца.
  await expect(page.getByTestId("run-status")).toContainText("done", { timeout: 30_000 });

  const history = page.getByTestId("runs-list");
  await expect(history).toContainText("Run now");
  await expect(history).toContainText("done");

  // История переживает перезагрузку — прогон записан, а не показан оптимистично.
  await page.reload();
  await expect(page.getByTestId("runs-list")).toContainText("done");
});

test("the plan decides what is offered, and locked assistants are visible", async ({ page }) => {
  const { clientId, email } = await setUpClientWithPrompts(page);
  await page.goto(`/clients/${clientId}/measure`);

  /**
   * Агентство только зарегистрировалось и ещё не платило — это бесплатный
   * аудит. Расписание без оплаты не запустится ни разу, поэтому формы нет
   * вовсе, а вход в бесплатный аудит — один, через экран аудита.
   */
  await expect(page.getByTestId("schedule-needs-plan")).toBeVisible();
  await expect(page.getByRole("button", { name: "Save schedule" })).toHaveCount(0);

  await runFreeAudit(page);

  // Claude измеряем — у него есть API, он просто не куплен. В заметке
  // «не измеряем» остаются только те, у кого API нет вовсе.
  await page.goto(`/clients/${clientId}`);
  const note = page.getByTestId("unmeasured-note");
  await expect(note).toContainText("Copilot");
  await expect(note).not.toContainText("Claude");
  await expect(note).not.toContainText("Grok");

  // После оплаты starter форма предлагает ровно то, что он покрывает.
  await makeAgencyPaying(email, "starter");
  await page.goto(`/clients/${clientId}/measure`);
  await expect(page.getByLabel("ChatGPT")).toBeChecked();
  await expect(page.getByLabel("Perplexity")).toBeChecked();
  // С 08.10.2026 Claude в умолчании, Google AI Overviews — по желанию.
  await expect(page.getByLabel("Claude")).toBeChecked();
  await expect(page.getByLabel("Google AI Overviews")).not.toBeChecked();
  await expect(page.getByLabel("Google AI Overviews")).toBeEnabled();

  // Запертое видно, а не спрятано, и подписано тарифом, на котором включается.
  await expect(page.getByLabel("Grok")).not.toBeChecked();
  await expect(page.getByLabel("Grok")).toBeDisabled();
  await expect(page.getByTestId("assistant-locked-grok")).toContainText("growth");

  // Умолчание сохраняется без отказа.
  await page.getByRole("button", { name: "Save schedule" }).click();
  await expect(page.getByTestId("schedule-summary")).toContainText("ChatGPT");
  await expect(page.getByTestId("form-error")).toHaveCount(0);

  // Снятое остаётся снятым: форма показывает сохранённое, а не умолчания —
  // иначе следующее «Save» молча вернуло бы выключенное.
  await page.getByLabel("Perplexity").uncheck();
  await page.getByRole("button", { name: "Save schedule" }).click();
  await expect(page.getByTestId("schedule-summary")).not.toContainText("Perplexity");

  await page.reload();
  await expect(page.getByLabel("Perplexity")).not.toBeChecked();
  await expect(page.getByLabel("ChatGPT")).toBeChecked();
});

test("running a check without prompts explains what to do", async ({ page }) => {
  const email = `runs-empty-${Math.random().toString(36).slice(2, 10)}@northwind-agency.test`;

  await page.goto("/signup");
  await page.getByLabel("Your name").fill("Empty Tester");
  await page.getByLabel("Agency name").fill("QA Agency");
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
  await page.getByRole("link", { name: "Run the free audit" }).click();

  // Пустой прогон не создаётся: он стоил бы денег и дал бы пустое окно измерения.
  // Экран аудита без вопросов не предлагает запуск, а ведёт их завести.
  await expect(page.getByText("No prompts to audit yet")).toBeVisible();
  await expect(page.getByTestId("run-audit")).toHaveCount(0);
});
