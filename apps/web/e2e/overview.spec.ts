import { expect, test } from "@playwright/test";
import { runFreeAudit } from "./free-audit";

/** Verify T24: график и карточки на обзорном экране строятся из visibility_snapshots. */

const CSV = [
  "cluster,intent,prompt,is_control",
  "CRM comparison,comparison,best CRM for startups,false",
  "CRM comparison,comparison,easiest CRM for a small sales team,false",
].join("\n");

test("client overview shows visibility built from a completed run", async ({ page }) => {
  const email = `overview-${Math.random().toString(36).slice(2, 10)}@northwind-agency.test`;

  await page.goto("/signup");
  await page.getByLabel("Your name").fill("Overview Tester");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/clients/new");
  await page.getByLabel("Client name").fill("AcmeCRM");
  await page.getByLabel("Domain").fill("acmecrm.test");
  await page.getByLabel("Brand names").fill("AcmeCRM, Acme CRM, Acme");
  await page.getByLabel("Competitors").fill("Northstack, Pipewell");
  await page.getByRole("button", { name: "Create client" }).click();
  // Заведение клиента ведёт на второй шаг онбординга, а не в список.
  await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}\/onboarding$/);
  await page.goto(page.url().replace(/\/onboarding$/, ""));
  const clientId = page.url().split("/").pop()!;

  // До измерений экран честно говорит, что данных нет, вместо нуля.
  await expect(page.getByTestId("stat-visibility")).toHaveText("—");
  await expect(page.getByText("No visibility data yet")).toBeVisible();

  await page.goto(`/clients/${clientId}/measure`);
  await page.getByLabel("Prompts CSV").setInputFiles({
    name: "prompts.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(CSV, "utf8"),
  });
  await expect(page.getByTestId("import-summary")).toContainText("2 prompts");

  await runFreeAudit(page);

  await page.goto(`/clients/${clientId}`);

  // Главная проверка: цифра посчитана из снапшотов и график отрисован.
  await expect(page.getByTestId("stat-visibility")).toHaveText(/^\d+(\.\d+)?%$/);
  await expect(page.getByTestId("stat-gap")).toContainText("pp");
  await expect(page.getByTestId("visibility-chart")).toBeVisible();

  // Фильтр по платформе перезапрашивает данные и не ломает экран.
  await page.getByLabel("Platform").selectOption("chatgpt");
  await expect(page.getByTestId("stat-visibility")).toHaveText(/^\d+(\.\d+)?%$/);

  // Цифра переживает перезагрузку — она из БД, а не из состояния страницы.
  await page.reload();
  await expect(page.getByTestId("stat-visibility")).toHaveText(/^\d+(\.\d+)?%$/);

  // Список клиентов показывает ту же долю, а не вечный прочерк: здесь долго
  // стояла заглушка, пережившая сам расчёт видимости.
  await page.goto("/clients");
  await expect(page.getByTestId(`client-visibility-${clientId}`)).toHaveText(/^\d+%$/);
});
