import { expect, test } from "@playwright/test";
import { runFreeAudit } from "./free-audit";

/**
 * Verify T34: таблица источников и распределение типов на экране совпадают
 * с тем, что отдаёт API, а не показывают правдоподобную выдумку.
 */

const CSV = [
  "cluster,intent,prompt,is_control",
  "CRM comparison,comparison,best CRM for startups,false",
  "CRM comparison,comparison,easiest CRM for a small sales team,false",
].join("\n");

test("diagnose screen shows source mix, presence matrix and reasoned recommendations", async ({
  page,
}) => {
  const email = `diag-${Math.random().toString(36).slice(2, 10)}@northwind-agency.test`;

  await page.goto("/signup");
  await page.getByLabel("Your name").fill("Diagnose Tester");
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
  // Заведение клиента ведёт на второй шаг онбординга, а не в список.
  await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}\/onboarding$/);
  await page.goto(page.url().replace(/\/onboarding$/, ""));
  const clientId = page.url().split("/").pop()!;

  // До прогона экран честно говорит, что цитат ещё нет.
  await page.goto(`/clients/${clientId}/diagnose`);
  await expect(page.getByText("No cited sources yet")).toBeVisible();

  await page.goto(`/clients/${clientId}/measure`);
  await page.getByLabel("Prompts CSV").setInputFiles({
    name: "prompts.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(CSV, "utf8"),
  });
  await expect(page.getByTestId("import-summary")).toContainText("2 prompts");

  await runFreeAudit(page);

  await page.goto(`/clients/${clientId}/diagnose`);

  // Вывод берётся из утверждённых формулировок и не содержит запрещённых слов.
  const statement = page.getByTestId("diagnosis-statement");
  await expect(statement).toBeVisible();
  await expect(statement).not.toContainText(/proof|proven|guaranteed|caused/i);

  // Распределение типов: доли складываются в 100% с точностью до округления.
  const mixText = await page.getByTestId("source-mix-list").innerText();
  const shares = [...mixText.matchAll(/([\d.]+)%/g)].map((m) => Number(m[1]));
  expect(shares.length).toBeGreaterThan(0);
  const total = shares.reduce((sum, value) => sum + value, 0);
  expect(total).toBeGreaterThan(99);
  expect(total).toBeLessThan(101);

  // Таблица источников: reviewgrid.example классифицирован как площадка отзывов.
  const table = page.getByTestId("sources-table");
  await expect(table).toContainText("reviewgrid.example");
  await expect(table).toContainText("Review platforms");
  // Собственный домен клиента опознан.
  await expect(table).toContainText("acmecrm.test");
  await expect(table).toContainText("Owned");

  // Матрица присутствия: есть и отметки клиента, и чипы конкурентов.
  await expect(page.getByTestId("client-present").first()).toBeVisible();
  await expect(table).toContainText("Northstack");

  // Сводка разрыва совпадает по формату с данными диагностики.
  await expect(page.getByTestId("gap-summary")).toContainText(/Client in \d+ of \d+/);

  /**
   * Рекомендации по этим данным есть — и каждая обязана объяснять себя.
   *
   * Раньше здесь проверялось обратное: на прежних фикстурах клиент звучал
   * почти в каждом ответе, и рекомендовать было нечего. Набор ответов с тех
   * пор пополнился случаем, ради которого продукт и существует — модель
   * отвечает по чужим площадкам и клиента не называет, — так что проверять
   * надо не отсутствие работы, а то, что каждая предложенная работа
   * обоснована. Случай «рекомендовать нечего» остался выше: до прогона экран
   * честно говорит, что цитат ещё нет.
   */
  const reasons = await page.getByTestId("recommendation-reason").allInnerTexts();
  expect(reasons.length).toBeGreaterThan(0);
  for (const reason of reasons) {
    expect(reason.trim().length).toBeGreaterThan(0);
    expect(reason).not.toMatch(/proof|proven|guarantee|caused/i);
  }
});

test("a client missing from the answers gets reasoned recommendations", async ({ page }) => {
  const email = `gap-${Math.random().toString(36).slice(2, 10)}@northwind-agency.test`;

  await page.goto("/signup");
  await page.getByLabel("Your name").fill("Gap Tester");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  // Бренд, которого нет ни в одном ответе платформ, но конкуренты там есть —
  // это и есть типичный новый клиент с нулевой видимостью.
  await page.goto("/clients/new");
  await page.getByLabel("Client name").fill("Northwind CRM");
  await page.getByLabel("Domain").fill("northwind-crm.test");
  await page.getByLabel("Brand names").fill("Northwind CRM, Northwind");
  await page.getByLabel("Competitors").fill("Northstack, Pipewell, Clasp");
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
  await expect(page.getByTestId("import-summary")).toContainText("2 prompts");

  await runFreeAudit(page);

  await page.goto(`/clients/${clientId}/diagnose`);

  // Клиента нет ни в одном источнике, конкуренты есть — разрыв виден.
  await expect(page.getByTestId("gap-summary")).toContainText("Client in 0 of");
  await expect(page.getByTestId("client-absent").first()).toBeVisible();

  const reasons = page.getByTestId("recommendation-reason");
  await expect(reasons.first()).toBeVisible();

  const reasonCount = await reasons.count();
  expect(reasonCount).toBeGreaterThan(0);
  for (let i = 0; i < reasonCount; i++) {
    const text = await reasons.nth(i).innerText();
    expect(text.trim().length).toBeGreaterThan(20);
    // Инвариант 7: объяснение опирается на числа, а не на общие слова.
    expect(text).toMatch(/\d/);
  }

  // Рекомендация превращается в действие одним кликом.
  const createAction = page.getByTestId("create-action").first();
  await expect(createAction).toBeEnabled();
  await createAction.click();
  await expect(createAction).toHaveText("Added to actions");

  // Повторный клик невозможен — очередь действий не журнал нажатий.
  await expect(createAction).toBeDisabled();
});
