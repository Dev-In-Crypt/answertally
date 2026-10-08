import { expect, test } from "@playwright/test";
import { runFreeAudit } from "./free-audit";

/** Verify T23: подсветка упоминаний в сыром ответе после mock-прогона. */

/** Место клиента среди названных брендов видно на каждом ответе. */
const RANK_BADGE = /named (first|\d+(st|nd|rd|th))/;

const CSV = [
  "cluster,intent,prompt,is_control",
  "CRM comparison,comparison,best CRM for startups,false",
].join("\n");

test("raw answers show highlighted client and competitor mentions", async ({ page }) => {
  const email = `resp-${Math.random().toString(36).slice(2, 10)}@northwind-agency.test`;

  await page.goto("/signup");
  await page.getByLabel("Your name").fill("Responses Tester");
  await page.getByLabel("Agency name").fill("QA Agency");
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

  await page.goto(`/clients/${clientId}/measure`);
  await page.getByLabel("Prompts CSV").setInputFiles({
    name: "prompts.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(CSV, "utf8"),
  });
  await expect(page.getByTestId("import-summary")).toContainText("1 prompts");

  // Пока прогона не было — экран честно говорит, что данных нет.
  await page.getByRole("link", { name: "best CRM for startups" }).click();
  await expect(page).toHaveURL(/\/prompts\/[0-9a-f-]{36}$/);
  await expect(page.getByText("No answers yet")).toBeVisible();

  await page.goto(`/clients/${clientId}/measure`);
  await runFreeAudit(page);

  await page.getByRole("link", { name: "best CRM for startups" }).click();

  const responses = page.getByTestId("responses-list");
  // 3 платформы × 3 сэмпла: бесплатный аудит меряет Perplexity,
  // Google AI Overviews и Claude; Grok в него не входит по цене.
  await expect(responses.locator("> li")).toHaveCount(9);

  // Главная проверка: клиент и конкуренты подсвечены в сыром тексте.
  await expect(page.getByTestId("mention-client").first()).toContainText(/Acme/);
  await expect(page.getByTestId("mention-competitor").first()).toContainText(/Northstack|Pipewell/);

  // Ссылки платформы показаны — на них строится диагностика источников.
  await expect(page.getByTestId("response-citations").first()).toContainText("reviewgrid.example");

  // У каждого ответа видно не только «назван ли», но и каким по счёту:
  // четвёртым в списке «а ещё бывают» — это не то же, что первым.
  await expect(page.getByTestId("named-rank").first()).toContainText(RANK_BADGE);
  await expect(page.getByTestId("named-in")).toContainText("named in");

  // Версия модели и стоимость видны у каждого ответа: без версии история
  // измерений несравнима между собой (провайдер меняет модель под тем же именем).
  // Имена моделей — из набора бесплатного аудита: агентство только
  // зарегистрировалось и ещё не платило, а Grok туда не входит по цене.
  await expect(responses).toContainText("claude-haiku-4-5-fixture");
  await expect(responses).toContainText("sonar-pro-2026-04");
  await expect(responses.locator("> li").first()).toContainText("$0.");
});
