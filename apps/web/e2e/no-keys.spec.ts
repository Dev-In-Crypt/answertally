import { expect, test, type Page } from "@playwright/test";
import { runFreeAudit } from "./free-audit";

/**
 * Verify: продукт полностью работает без единого внешнего ключа.
 *
 * Это не удобство разработки, а обещание: агентство должно пройти весь путь
 * — завести клиента, измерить, собрать отчёт и отдать его ссылкой — раньше,
 * чем кто-то настроит оплату, почту или сбор ошибок. Здесь же проверяется,
 * что продукт про отсутствие ключей не врёт: где сервиса нет, он так и
 * говорит, а не показывает кнопку, которая упадёт.
 *
 * Прогон идёт в окружении e2e, где ключей нет вовсе.
 */

const CSV = [
  "cluster,intent,prompt,is_control",
  "CRM comparison,comparison,best CRM for startups,false",
  "CRM basics,learning,what to look for when choosing a CRM,false",
].join("\n");

async function signUp(page: Page): Promise<string> {
  const email = `nokeys-${Math.random().toString(36).slice(2, 10)}@northwind-agency.test`;
  await page.goto("/signup");
  await page.getByLabel("Your name").fill("No Keys Tester");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  return email;
}

test("an agency goes from signup to a client-ready report with no external keys", async ({
  page,
  browser,
}) => {
  test.setTimeout(180_000);
  await signUp(page);

  await page.goto("/clients/new");
  await page.getByLabel("Client name").fill("AcmeCRM");
  await page.getByLabel("Domain").fill("acmecrm.test");
  await page.getByLabel("Brand names").fill("AcmeCRM, Acme");
  await page.getByLabel("Competitors").fill("Northstack, Pipewell");
  await page.getByRole("button", { name: "Create client" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);
  const clientId = page.url().split("/").at(-2)!;

  // Измерение: без ключей платформ работают фикстуры, и это видно в расходах.
  await page.goto(`/clients/${clientId}/measure`);
  await page.getByLabel("Prompts CSV").setInputFiles({
    name: "prompts.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(CSV, "utf8"),
  });
  await expect(page.getByTestId("import-summary")).toContainText("2 prompts");
  await runFreeAudit(page, 60_000);

  // Отчёт клиенту собирается и открывается по ссылке без входа в продукт.
  await page.goto(`/clients/${clientId}/reports`);
  await page.getByRole("button", { name: "Generate report" }).click();
  const list = page.getByTestId("reports-list");
  await expect(list).toBeVisible({ timeout: 30_000 });
  await list.locator('[data-testid^="share-"]').first().click();

  const shareLink = page.getByTestId("share-link");
  await expect(shareLink).toBeVisible({ timeout: 30_000 });
  const href = (await shareLink.locator("a").first().getAttribute("href")) ?? "";
  const token = href.split("/r/").at(-1)!.trim();
  expect(token).not.toBe("");

  const anonymous = await browser.newContext();
  const anonPage = await anonymous.newPage();
  await anonPage.goto(`/r/${token}`);
  await expect(anonPage.getByTestId("report-visibility")).toContainText("%");
  await anonymous.close();
});

test("without keys the product says so instead of offering something that would fail", async ({
  page,
}) => {
  await signUp(page);

  // Оплата: без ключей Stripe кнопки оплаты нет, и это сказано словами.
  await page.goto("/settings/billing");
  await expect(page.getByTestId("payments-off")).toBeVisible();
  await expect(page.getByRole("button", { name: /Pay|Checkout|Subscribe/i })).toHaveCount(0);

  // Почта: без ключа Resend приглашение не теряется — ссылку показывают на экране.
  await page.goto("/settings");
  await page
    .getByLabel("Invite a teammate")
    .fill(`mate-${Math.random().toString(36).slice(2, 8)}@northwind-agency.test`);
  await page.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByTestId("invite-link")).toContainText("/invite/");
});

test("no external service is contacted when no keys are set", async ({ page }) => {
  const external: string[] = [];
  page.on("request", (request) => {
    const url = new URL(request.url());
    // Всё, что уходит не на сам продукт: сторонние вызовы без ключей означали
    // бы, что где-то зашит адрес, о котором никто не просил.
    if (!["127.0.0.1", "localhost"].includes(url.hostname)) external.push(request.url());
  });

  await signUp(page);
  await page.goto("/settings/billing");
  await page.goto("/dashboard");
  await page.goto("/");

  expect(external).toEqual([]);
});
