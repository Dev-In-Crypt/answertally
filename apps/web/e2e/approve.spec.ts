import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Verify T52: approve из анонимной сессии отражается в приложении агентства.
 */

const CSV = [
  "cluster,intent,prompt,is_control",
  "CRM comparison,comparison,best CRM for startups,false",
].join("\n");

async function setUpReport(page: Page): Promise<{ clientId: string; token: string }> {
  const email = `approve-${Math.random().toString(36).slice(2, 10)}@northwind-agency.test`;

  await page.goto("/signup");
  await page.getByLabel("Your name").fill("Approve Tester");
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
  await page.goto(page.url().replace(/\/onboarding$/, ""));
  const clientId = page.url().split("/").pop()!;

  await page.goto(`/clients/${clientId}/measure`);
  await page.getByLabel("Prompts CSV").setInputFiles({
    name: "prompts.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(CSV, "utf8"),
  });
  // Импорт асинхронный: без ожидания «Run now» иногда жмётся раньше, чем
  // промпты доедут до списка, и прогон отказывается стартовать.
  await expect(page.getByText(/Imported \d+ prompts/)).toBeVisible();
  await page.getByRole("button", { name: "Run now" }).click();
  await expect(page.getByTestId("run-status")).toContainText("done", { timeout: 30_000 });

  await page.goto(`/clients/${clientId}/reports`);
  await page.getByTestId("generate-report").click();
  await expect(page.getByTestId("reports-list").locator("li")).toHaveCount(1);
  // До оплаты отчёт письмом не уходит — только ссылкой: иначе наш домен
  // стал бы рассылкой с подписью, которую задаёт сам пользователь.
  await page.getByRole("button", { name: "Send to client" }).click();
  await page.getByLabel("Client email").fill("finance@acmecrm.test");
  await page.getByTestId("confirm-send").click();
  await expect(page.getByTestId("form-error")).toContainText("Copy the client link");
  await page.getByRole("button", { name: "Cancel" }).click();

  await page.getByRole("button", { name: "Get client link" }).click();

  const token = (await page.getByTestId("share-link").innerText()).split("/r/").at(-1)!.trim();
  return { clientId, token };
}

test("client approves the report by link and the agency sees it", async ({ page, browser }) => {
  const { clientId, token } = await setUpReport(page);

  const anonymous = await browser.newContext();
  const anonPage = await anonymous.newPage();
  await anonPage.goto(`/r/${token}`);

  // Форма подтверждения доступна без регистрации.
  await expect(anonPage.getByTestId("approve-form")).toBeVisible();

  await anonPage.getByLabel("Your name").fill("Dana from AcmeCRM");
  await anonPage.getByRole("button", { name: "Approve" }).click();

  // Подтверждение зафиксировано с именем, форма больше не предлагается.
  await expect(anonPage.getByTestId("report-approved")).toContainText("Dana from AcmeCRM");
  await expect(anonPage.getByTestId("approve-form")).toHaveCount(0);

  // Переживает перезагрузку — записано в БД, а не в состояние страницы.
  await anonPage.reload();
  await expect(anonPage.getByTestId("report-approved")).toContainText("Dana from AcmeCRM");

  // Агентство видит статус отчёта и событие в журнале.
  await page.goto(`/clients/${clientId}/reports`);
  await expect(page.getByTestId("reports-list")).toContainText("approved");

  await page.goto(`/clients/${clientId}`);
  await expect(page.getByTestId("activity-feed")).toContainText("Report approved");

  await anonymous.close();
});

test("approving an unknown link fails without revealing anything", async ({ browser }) => {
  const anonymous = await browser.newContext();
  const anonPage = await anonymous.newPage();

  // Битый токен не показывает ни отчёта, ни формы подтверждения.
  await anonPage.goto("/r/not-a-real-token-at-all");
  await expect(anonPage.getByText("This link is no longer valid")).toBeVisible();
  await expect(anonPage.getByTestId("approve-form")).toHaveCount(0);

  await anonymous.close();
});
