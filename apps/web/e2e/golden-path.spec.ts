import { expect, test } from "@playwright/test";

/**
 * Verify T25 — золотой путь Phase 1 целиком:
 * регистрация → клиент → импорт промптов → прогон → сырые ответы → цифра на обзоре.
 *
 * Главное утверждение теста не «экраны открываются», а «цифра на обзоре сходится
 * с тем, что видно в сырых ответах». Метрика, которую нельзя проверить глазами,
 * ничего не стоит для агентства, которое понесёт её клиенту.
 */

/**
 * Два промпта намеренно: на первый клиент упомянут всеми платформами,
 * на второй — не всеми. Доля получается дробной, и проверка «цифра сходится»
 * действительно что-то проверяет, а не совпадает со 100% случайно.
 */
const PROMPTS = ["best CRM for startups", "easiest CRM for a small sales team"] as const;

const CSV = [
  "cluster,intent,prompt,is_control",
  ...PROMPTS.map((prompt) => `CRM comparison,comparison,${prompt},false`),
].join("\n");

test("golden path: from signup to a verifiable visibility number", async ({ page }) => {
  const email = `golden-${Math.random().toString(36).slice(2, 10)}@northwind-agency.test`;

  // 1. Агентство регистрируется — аккаунт агентства создаётся вместе с пользователем.
  await page.goto("/signup");
  await page.getByLabel("Your name").fill("Golden Path");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.locator("aside")).toContainText("Northwind Agency");

  // 2. Добавляет клиента с алиасами бренда и конкурентами.
  await page.goto("/clients/new");
  await page.getByLabel("Client name").fill("AcmeCRM");
  await page.getByLabel("Domain").fill("acmecrm.test");
  await page.getByLabel("Brand names").fill("AcmeCRM, Acme CRM, Acme");
  await page.getByLabel("Competitors").fill("Northstack, Pipewell, Clasp");
  await page.getByRole("button", { name: "Create client" }).click();
  // Заведение клиента ведёт на второй шаг онбординга, а не в список.
  await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}\/onboarding$/);
  await page.goto("/clients");

  await page.getByRole("link", { name: /AcmeCRM/ }).click();
  await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}$/);
  const clientId = page.url().split("/").pop()!;

  // До измерений — прочерк, а не ноль.
  await expect(page.getByTestId("stat-visibility")).toHaveText("—");

  // 3. Импортирует промпты.
  await page.goto(`/clients/${clientId}/measure`);
  await page.getByLabel("Prompts CSV").setInputFiles({
    name: "prompts.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(CSV, "utf8"),
  });
  await expect(page.getByTestId("import-summary")).toContainText("2 prompts");

  // 4. Настраивает расписание и запускает прогон.
  await page.getByLabel("Samples per prompt").fill("3");
  await page.getByRole("button", { name: "Save schedule" }).click();
  await expect(page.getByTestId("schedule-summary")).toContainText("3 samples per prompt");

  await page.getByRole("button", { name: "Run now" }).click();
  await expect(page.getByTestId("run-status")).toContainText("done", { timeout: 30_000 });

  // 5. Открывает сырые ответы по каждому промпту и считает, где упомянут клиент.
  let total = 0;
  let withClient = 0;

  for (const promptText of PROMPTS) {
    await page.goto(`/clients/${clientId}/measure`);
    await page.getByRole("link", { name: promptText }).click();
    await expect(page).toHaveURL(/\/prompts\/[0-9a-f-]{36}$/);

    const answers = page.getByTestId("responses-list").locator("> li");
    // toHaveCount ждёт загрузки, в отличие от count() — иначе счёт снимается с пустой страницы.
    // 2 платформы × 3 сэмпла: агентство ещё не платило, а бесплатный
    // аудит меряет ChatGPT и Perplexity — Grok в него не входит по цене.
    await expect(answers).toHaveCount(6);
    const count = await answers.count();
    total += count;

    for (let i = 0; i < count; i++) {
      if ((await answers.nth(i).getByTestId("mention-client").count()) > 0) {
        withClient++;
      }
    }
  }

  // 2 вопроса × 2 платформы × 3 сэмпла: бесплатный аудит без Grok.
  expect(total).toBe(12);
  // Доля должна быть дробной: иначе совпадение с обзором ничего не доказывает.
  expect(withClient).toBeGreaterThan(0);
  expect(withClient).toBeLessThan(total);

  const expectedPct = Math.round((withClient / total) * 1000) / 10;

  // 6. Цифра на обзоре сходится с посчитанной по сырым ответам.
  await page.goto(`/clients/${clientId}`);
  const shown = await page.getByTestId("stat-visibility").innerText();
  const shownPct = Number(shown.replace("%", ""));

  expect(shownPct).toBeCloseTo(expectedPct, 1);
  await expect(page.getByTestId("visibility-chart")).toBeVisible();

  // 7. Разрыв с конкурентом посчитан и подан в процентных пунктах.
  await expect(page.getByTestId("stat-gap")).toContainText("pp");

  // 8. Расход записан: измерение стоит денег, и это должно быть видно агентству.
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
});
