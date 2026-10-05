import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Verify T07: создать клиента с 2 alias бренда и 3 конкурентами, увидеть в списке.
 */

async function signUpFreshAgency(page: Page): Promise<void> {
  const email = `clients-${Math.random().toString(36).slice(2, 10)}@northwind-agency.test`;
  await page.goto("/signup");
  await page.getByLabel("Your name").fill("Clients Tester");
  await page.getByLabel("Agency name").fill("QA Agency");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test("create a client with brand aliases and competitors, then edit it", async ({ page }) => {
  await signUpFreshAgency(page);

  await page.goto("/clients");
  await expect(page.getByText("No clients yet")).toBeVisible();

  await page.getByRole("link", { name: "Add client" }).first().click();
  await expect(page).toHaveURL(/\/clients\/new$/);

  await page.getByLabel("Client name").fill("AcmeCRM");
  await page.getByLabel("Domain").fill("acmecrm.com");
  await page.getByLabel("Industry").fill("B2B SaaS / CRM");
  await page.getByLabel("Brand names").fill("AcmeCRM, Acme CRM");
  await page.getByLabel("Competitors").fill("Northstack, Pipewell, Clasp");
  await page.getByRole("button", { name: "Create client" }).click();
  // Заведение клиента ведёт на второй шаг онбординга, а не в список.
  await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}\/onboarding$/);
  await page.goto("/clients");
  const list = page.getByTestId("clients-list");
  await expect(list).toContainText("AcmeCRM");
  await expect(list).toContainText("acmecrm.com");
  // Три конкурента доехали до карточки.
  await expect(list).toContainText("3");

  // Открыть и убедиться, что списки сохранились ровно как введены.
  await page.getByRole("link", { name: /AcmeCRM/ }).click();
  await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}$/);
  // Уточняем область: «Settings» есть и в сайдбаре агентства.
  await page.getByRole("main").getByRole("link", { name: "Settings" }).click();
  await expect(page.getByLabel("Brand names")).toHaveValue("AcmeCRM, Acme CRM");
  await expect(page.getByLabel("Competitors")).toHaveValue("Northstack, Pipewell, Clasp");

  await page.getByLabel("Client name").fill("AcmeCRM Renamed");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page).toHaveURL(/\/clients$/);
  await expect(page.getByTestId("clients-list")).toContainText("AcmeCRM Renamed");
});

test("client screens are tabs: the current one is marked and the way back is there", async ({
  page,
}) => {
  await signUpFreshAgency(page);

  await page.goto("/clients/new");
  await page.getByLabel("Client name").fill("Tabbed Co");
  await page.getByLabel("Domain").fill("tabbed.test");
  await page.getByRole("button", { name: "Create client" }).click();
  // Заведение клиента ведёт на второй шаг онбординга, а не в список.
  await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}\/onboarding$/);
  await page.goto(page.url().replace(/\/onboarding$/, ""));

  const tabs = page.getByTestId("client-tabs");
  await expect(tabs.getByRole("link", { name: "Overview" })).toHaveAttribute(
    "aria-current",
    "page",
  );

  // Уход на другой экран клиента переносит подсветку, а не теряет вкладки.
  await tabs.getByRole("link", { name: "Opportunities" }).click();
  await expect(page).toHaveURL(/\/opportunities$/);
  await expect(tabs.getByRole("link", { name: "Opportunities" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  await expect(tabs.getByRole("link", { name: "Overview" })).not.toHaveAttribute(
    "aria-current",
    "page",
  );

  // Приборы — на втором уровне: измерения и источники живут внутри Measure,
  // а не в одном ряду с решениями. Подписи вкладки, подвкладки и заголовка
  // экрана совпадают намеренно — одно понятие, одно имя.
  await tabs.getByRole("link", { name: "Measure" }).first().click();
  await expect(page).toHaveURL(/\/measure$/);
  const subtabs = page.getByTestId("client-subtabs");
  await subtabs.getByRole("link", { name: "Diagnose" }).click();
  await expect(page).toHaveURL(/\/diagnose$/);
  await expect(tabs.getByRole("link", { name: "Measure" }).first()).toHaveAttribute(
    "aria-current",
    "page",
  );

  // Имя клиента видно с любого экрана, и путь обратно к списку тоже.
  await expect(page.getByRole("heading", { name: "Tabbed Co" })).toBeVisible();
  await page.getByRole("link", { name: "All clients" }).click();
  await expect(page).toHaveURL(/\/clients$/);
});

test("a client from another agency is not reachable", async ({ page, browser }) => {
  // Первое агентство создаёт клиента и запоминает его id.
  await signUpFreshAgency(page);
  await page.goto("/clients/new");
  await page.getByLabel("Client name").fill("Secret Client");
  await page.getByLabel("Domain").fill("secret.test");
  await page.getByRole("button", { name: "Create client" }).click();
  // Заведение клиента ведёт на второй шаг онбординга, а не в список.
  await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}\/onboarding$/);
  await page.goto("/clients");
  await page.getByRole("link", { name: /Secret Client/ }).click();
  // Дождаться перехода: без этого page.url() ещё отдаёт страницу списка.
  await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}$/);
  const foreignUrl = page.url();

  // Второе агентство в отдельном контексте открывает тот же URL.
  const otherContext = await browser.newContext();
  const otherPage = await otherContext.newPage();
  await signUpFreshAgency(otherPage);
  await otherPage.goto(foreignUrl);

  await expect(otherPage.getByText("Client not found")).toBeVisible();
  await expect(otherPage.getByText("Secret Client")).toHaveCount(0);
  await otherContext.close();
});
