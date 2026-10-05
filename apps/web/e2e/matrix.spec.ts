import { expect, test } from "@playwright/test";
import { runFreeAudit } from "./free-audit";

/**
 * Verify T87/T88: экран клиента ведёт матрицей «промпт × ассистент»,
 * неспрошенные ассистенты помечены как неспрошенные, а три прочтения
 * одних и тех же ответов переключаются на месте.
 */

const CSV = [
  "cluster,intent,prompt,is_control",
  "Spend comparison,comparison,best expense management software for a 300-person company,false",
  "Spend comparison,comparison,Ledgerbrook vs Outlay,false",
].join("\n");

test("the client overview leads with the prompt × assistant matrix", async ({ page }) => {
  const email = `matrix-${Math.random().toString(36).slice(2, 10)}@northslope-agency.test`;

  await page.goto("/signup");
  await page.getByLabel("Your name").fill("Matrix Tester");
  await page.getByLabel("Agency name").fill("QA Agency");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/clients/new");
  await page.getByLabel("Client name").fill("Ledgerbrook");
  await page.getByLabel("Domain").fill("ledgerbrook.test");
  await page.getByLabel("Brand names").fill("Ledgerbrook, Ledgerbrook Inc");
  await page.getByLabel("Competitors").fill("Outlay, Spendhaven, Tallyard");
  await page.getByRole("button", { name: "Create client" }).click();

  // Новый клиент ведёт прямо на второй шаг настройки, а не в список.
  await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}\/onboarding$/);
  const clientId = page.url().split("/").at(-2)!;

  await page.goto(`/clients/${clientId}/measure`);
  await page.getByLabel("Prompts CSV").setInputFiles({
    name: "prompts.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(CSV, "utf8"),
  });
  await expect(page.getByText(/Imported \d+ prompts/)).toBeVisible();
  await runFreeAudit(page);

  await page.goto(`/clients/${clientId}`);

  // Что это за цифры — до самих цифр.
  await expect(page.getByTestId("method-note")).toContainText("estimated");

  // Столбцов восемь, и те, у кого нет публичного API (Copilot, поверхности
  // Google), честно помечены как неспрошенные. Claude и Grok в их числе нет:
  // адаптеры у них есть, просто клиенту они не включены — и это другое
  // состояние, «0 из 3 нужных ответов», а не «не спрашиваем».
  const unmeasured = page.getByTestId("matrix-cell-unmeasured");
  await expect(unmeasured.first()).toBeVisible();
  await expect(page.getByTestId("unmeasured-note")).toContainText("Copilot");
  await expect(page.getByTestId("unmeasured-note")).not.toContainText("Claude");
  await expect(page.getByTestId("unmeasured-note")).toContainText("not ask");

  // Измеренные ячейки несут проценты.
  await expect(page.getByTestId("matrix-cell").first()).toContainText("%");

  // Одна фраза, которую агентство перескажет клиенту.
  await expect(page.getByTestId("one-line-read")).toContainText("Ledgerbrook");

  // «Назван» и «назван первым» — разные вещи, и экран их различает.
  await expect(page.getByTestId("prominence-first")).toContainText("%");
  await expect(page.getByTestId("prominence-behind")).toContainText("%");

  // Те же ответы в двух других прочтениях.
  await page.getByTestId("matrix-view-bars").click();
  await expect(page.getByTestId("matrix-bars")).toBeVisible();

  await page.getByTestId("matrix-view-cards").click();
  await expect(page.getByTestId("matrix-cards")).toContainText("ChatGPT");
  await expect(page.getByTestId("matrix-cards")).toContainText("Claude");
});

test("the portfolio replaces the placeholder dashboard", async ({ page }) => {
  const email = `portfolio-${Math.random().toString(36).slice(2, 10)}@northslope-agency.test`;

  await page.goto("/signup");
  await page.getByLabel("Your name").fill("Portfolio Tester");
  await page.getByLabel("Agency name").fill("QA Agency");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();

  // Пустое агентство получает не пустую таблицу, а причину завести клиента.
  await expect(page.getByText("No clients yet")).toBeVisible();

  await page.goto("/clients/new");
  await page.getByLabel("Client name").fill("Ledgerbrook");
  await page.getByLabel("Domain").fill("ledgerbrook.test");
  await page.getByRole("button", { name: "Create client" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);

  await page.goto("/dashboard");

  const table = page.getByTestId("portfolio-table");
  await expect(table).toContainText("Ledgerbrook");
  // Ни одного измерения ещё не было: в клетке доли обязан стоять прочерк.
  await expect(table).toContainText("Awaiting first run");
  await expect(page.getByTestId("portfolio-thin")).toBeVisible();

  /**
   * Лента решений стоит выше таблицы и называет дело, а не цифру: у клиента,
   * которого ещё ни разу не измеряли, ждёт ровно один пункт, и кнопка рядом
   * ведёт туда, где его закрывают.
   */
  const feed = page.getByTestId("decision-feed");
  await expect(feed).toContainText("Ledgerbrook");
  await expect(feed).toContainText("Awaiting first run");
  await expect(feed.getByRole("link", { name: "Schedule" })).toHaveAttribute(
    "href",
    /\/measure$/,
  );

  // Та же работа, сложенная по её виду: выбор запоминается между заходами.
  await page.getByRole("button", { name: "By work" }).click();
  await expect(feed).toContainText("Measurement");
  await page.reload();
  await expect(page.getByRole("button", { name: "By work" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});
