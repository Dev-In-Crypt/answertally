import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/** Verify T21: импорт CSV на 10 строк создаёт 2 кластера и 10 промптов. */

const CSV_10 = [
  "cluster,intent,prompt,is_control",
  "CRM comparison,comparison,best CRM for startups,false",
  "CRM comparison,comparison,Northstack alternatives,false",
  "CRM comparison,comparison,easiest CRM for a small sales team,false",
  "CRM comparison,comparison,CRM with an open API,false",
  "CRM comparison,comparison,best project management tool for agencies,true",
  "CRM basics,learning,what is a sales CRM,false",
  "CRM basics,learning,how does CRM pipeline management work,false",
  "CRM basics,learning,CRM vs spreadsheet for a small team,false",
  "CRM basics,learning,what to look for when choosing a CRM,false",
  "CRM basics,learning,what is customer lifecycle management,true",
].join("\n");

async function signUpAndAddClient(page: Page): Promise<string> {
  const email = `measure-${Math.random().toString(36).slice(2, 10)}@northwind-agency.test`;

  await page.goto("/signup");
  await page.getByLabel("Your name").fill("Measure Tester");
  await page.getByLabel("Agency name").fill("QA Agency");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/clients/new");
  await page.getByLabel("Client name").fill("AcmeCRM");
  await page.getByLabel("Domain").fill("acmecrm.test");
  await page.getByRole("button", { name: "Create client" }).click();
  // Заведение клиента ведёт на второй шаг онбординга, а не в список.
  await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}\/onboarding$/);
  await page.goto("/clients");

  await page.getByRole("link", { name: /AcmeCRM/ }).click();
  await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}$/);
  return page.url().split("/").pop()!;
}

test("CSV import creates 2 clusters and 10 prompts", async ({ page }) => {
  const clientId = await signUpAndAddClient(page);

  await page.goto(`/clients/${clientId}/measure`);
  await expect(page.getByText("No prompt clusters yet")).toBeVisible();

  await page.getByLabel("Prompts CSV").setInputFiles({
    name: "prompts.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(CSV_10, "utf8"),
  });

  await expect(page.getByTestId("import-summary")).toContainText("10 prompts");
  await expect(page.getByTestId("import-summary")).toContainText("2 new clusters");

  const list = page.getByTestId("clusters-list");
  await expect(list.locator("> li")).toHaveCount(2);
  await expect(list).toContainText("CRM comparison");
  await expect(list).toContainText("CRM basics");
  await expect(list.getByText("5 prompts")).toHaveCount(2);

  // Контрольные промпты помечены — на них строятся эксперименты.
  await expect(list.getByTestId("control-badge")).toHaveCount(2);

  // Данные переживают перезагрузку.
  await page.reload();
  await expect(page.getByTestId("clusters-list").locator("> li")).toHaveCount(2);
});

test("clusters and prompts can be managed by hand", async ({ page }) => {
  const clientId = await signUpAndAddClient(page);
  await page.goto(`/clients/${clientId}/measure`);

  await page.getByLabel("Cluster name").fill("Pricing questions");
  await page.getByRole("button", { name: "Add cluster" }).click();
  await expect(page.getByTestId("clusters-list")).toContainText("Pricing questions");

  await page.getByPlaceholder("best CRM for startups").fill("how much does AcmeCRM cost");
  await page.getByRole("button", { name: "Add prompt" }).click();
  await expect(page.getByTestId("clusters-list")).toContainText("how much does AcmeCRM cost");
  await expect(page.getByTestId("clusters-list")).toContainText("1 prompts");

  // Удаление уносит измеренные ответы, поэтому спрашивает подтверждение.
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByLabel("Delete prompt how much does AcmeCRM cost").click();
  await expect(page.getByTestId("clusters-list")).toContainText("0 prompts");
});

test("CSV with broken rows reports them instead of dropping silently", async ({ page }) => {
  const clientId = await signUpAndAddClient(page);
  await page.goto(`/clients/${clientId}/measure`);

  const broken = ["cluster,intent,prompt,is_control", "A,other,good prompt,0", "A,other,,0"].join(
    "\n",
  );

  await page.getByLabel("Prompts CSV").setInputFiles({
    name: "broken.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(broken, "utf8"),
  });

  await expect(page.getByTestId("import-summary")).toContainText("1 prompts");
  await expect(page.getByTestId("import-errors")).toContainText("Line 3");
});
