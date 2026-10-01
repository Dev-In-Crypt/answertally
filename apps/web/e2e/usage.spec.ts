import { expect, test } from "@playwright/test";

/**
 * Verify T55: страница usage показывает израсходованные проверки за период.
 */

const CSV = [
  "cluster,intent,prompt,is_control",
  "CRM comparison,comparison,best CRM for startups,false",
].join("\n");

test("usage page shows the checks the answers used", async ({ page }) => {
  const email = `usage-${Math.random().toString(36).slice(2, 10)}@northwind-agency.test`;

  await page.goto("/signup");
  await page.getByLabel("Your name").fill("Usage Tester");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  // Пустое состояние до первых измерений — экранов без содержимого быть не должно.
  await page.goto("/settings/usage");
  await expect(page.getByText("No checks used in this period")).toBeVisible();

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

  await page.getByRole("link", { name: "best CRM for startups" }).click();
  const answers = page.getByTestId("responses-list").locator("> li");
  // 2 платформы × 3 сэмпла: агентство ещё не платило, а бесплатный аудит
  // меряет ChatGPT и Perplexity — Grok в него не входит по цене.
  await expect(answers).toHaveCount(6);
  const answerCount = await answers.count();

  // Прогон шёл на фикстурах: проверок он не стоил, и страница расхода не
  // должна выдавать его за израсходованное. Ответы посчитаны отдельной
  // строкой, в лимит не идут.
  await page.goto("/settings/usage");
  await expect(page.getByTestId("usage-fixtures")).toContainText(String(answerCount));
  await expect(page.getByText("No checks used in this period")).toBeVisible();
  await expect(page.getByTestId("usage-total")).toHaveCount(0);
});
