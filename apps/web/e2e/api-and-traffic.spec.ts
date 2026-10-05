import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";

/**
 * Verify T96/T97: ключ выдаётся один раз и работает, а импорт переходов
 * появляется на экране клиента рядом с видимостью, а не внутри неё.
 */

async function signUp(page: Page, prefix: string): Promise<void> {
  const email = `${prefix}-${Math.random().toString(36).slice(2, 10)}@northslope-agency.test`;

  await page.goto("/signup");
  await page.getByLabel("Your name").fill("API Tester");
  await page.getByLabel("Agency name").fill("QA Agency");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test("an API key is shown once and then reads the agency's own numbers", async ({
  page,
  request,
}) => {
  await signUp(page, "apikey");

  await page.goto("/clients/new");
  await page.getByLabel("Client name").fill("Ledgerbrook");
  await page.getByLabel("Domain").fill("ledgerbrook.test");
  await page.getByRole("button", { name: "Create client" }).click();
  await expect(page).toHaveURL(/\/onboarding$/);

  // Ключи живут в настройках агентства, а не отдельным пунктом меню:
  // за ними заходят раз в жизнь, и искать их станут именно там.
  await page.goto("/settings");
  await page.getByRole("link", { name: "API keys" }).click();
  await expect(page).toHaveURL(/\/settings\/api$/);

  await page.getByLabel("What is it for").fill("Looker Studio");
  await page.getByTestId("create-api-key").click();

  const issued = page.getByTestId("issued-key");
  await expect(issued).toContainText("cw_live_");
  const token = (await issued.locator("code").innerText()).trim();

  // Второй раз ключ не показывается: в базе только хэш.
  await page.reload();
  await expect(page.getByTestId("issued-key")).toHaveCount(0);
  await expect(page.getByTestId("api-keys")).toContainText("Looker Studio");

  // Ключ действительно читает данные своего агентства.
  const response = await request.get("/api/v1/clients", {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(response.status()).toBe(200);
  const body = (await response.json()) as { data: { name: string }[] };
  expect(body.data.map((row) => row.name)).toContain("Ledgerbrook");

  // Без ключа тот же адрес не отдаёт ничего.
  expect((await request.get("/api/v1/clients")).status()).toBe(401);

  // Отозванный ключ перестаёт работать сразу. Отзыв необратим и спрашивает подтверждение.
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", { name: "Revoke" }).first().click();
  await expect(page.getByText("revoked")).toBeVisible();

  const afterRevoke = await request.get("/api/v1/clients", {
    headers: { authorization: `Bearer ${token}` },
  });
  expect(afterRevoke.status()).toBe(401);
});

test("imported assistant traffic sits beside visibility, not inside it", async ({ page }) => {
  await signUp(page, "traffic");

  await page.goto("/clients/new");
  await page.getByLabel("Client name").fill("Ledgerbrook");
  await page.getByLabel("Domain").fill("ledgerbrook.test");
  await page.getByRole("button", { name: "Create client" }).click();
  await expect(page).toHaveURL(/\/clients\/[0-9a-f-]{36}\/onboarding$/);
  await page.goto(page.url().replace(/\/onboarding$/, ""));

  // До импорта экран объясняет, чего не хватает, а не показывает ноль.
  await expect(page.getByTestId("traffic-empty")).toBeVisible();

  const today = new Date().toISOString().slice(0, 10);
  const csv = ["date,source,sessions", `${today},chatgpt.com,42`, `${today},google,900`].join("\n");

  await page.getByLabel("Import a referral export").setInputFiles({
    name: "traffic.csv",
    mimeType: "text/csv",
    buffer: Buffer.from(csv, "utf8"),
  });

  await expect(page.getByTestId("traffic-total")).toHaveText("42");
  await expect(page.getByTestId("traffic-list")).toContainText("ChatGPT");
  // Источник не из ассистентов назван поимённо, а не отброшен молча.
  await expect(page.getByTestId("traffic-import")).toContainText("google");
});
