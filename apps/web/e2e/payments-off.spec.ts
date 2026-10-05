import { expect, test } from "@playwright/test";

/**
 * Без ключей платёжного провайдера продукт остаётся рабочим и не врёт.
 *
 * Проверяется вход, который меняет права агентства без участия человека:
 * вебхук. Ключа в этом окружении нет вовсе, поэтому подписать событие
 * некому — и ровно это здесь и нужно. Подделанное событие не должно ни
 * повысить кому-то тариф, ни уронить приложение, ни рассказать о себе
 * лишнего в ответе.
 *
 * Разбор самих событий покрыт юнит-тестами роутера; тут — поведение
 * собранного приложения на живом HTTP.
 */

const FAKE_EVENT = JSON.stringify({
  id: "evt_e2e_not_real",
  type: "customer.subscription.updated",
  data: { object: { customer: "cus_e2e", status: "active" } },
});

test("an unsigned webhook is refused", async ({ request }) => {
  const response = await request.post("/api/webhooks/stripe", {
    headers: { "content-type": "application/json" },
    data: FAKE_EVENT,
  });

  // 400, а не 500: отсутствие подписи — это отказ, а не поломка.
  expect(response.status()).toBe(400);
  expect(await response.json()).toEqual({ error: "Missing signature" });
});

test("a forged signature is refused without saying why", async ({ request }) => {
  const response = await request.post("/api/webhooks/stripe", {
    headers: {
      "content-type": "application/json",
      "stripe-signature": "t=1,v1=0000000000000000000000000000000000000000000000000000000000000000",
    },
    data: FAKE_EVENT,
  });

  expect(response.status()).toBe(400);
  const body = await response.text();
  // Ответ не подсказывает, чего не хватило: ни имени переменной, ни того,
  // настроен ли провайдер вообще.
  expect(body).not.toMatch(/STRIPE|secret|whsec|not configured/i);
});

test("the billing screen offers nothing that would fail", async ({ page }) => {
  const email = `pay-${Math.random().toString(36).slice(2, 10)}@northwind-agency.test`;
  await page.goto("/signup");
  await page.getByLabel("Your name").fill("Payments Tester");
  await page.getByLabel("Agency name").fill("QA Agency");
  await page.getByLabel("Work email").fill(email);
  await page.getByLabel("Password").fill("correct-horse-battery");
  await page.getByRole("button", { name: "Create account" }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  await page.goto("/settings/billing");
  await expect(page.getByTestId("payments-off")).toBeVisible();

  // И витрина говорит то же самое: страница тарифов не обещает оплату
  // картой, пока провайдера нет. Одно обещание на два экрана.
  await page.goto("/pricing");
  // Точное совпадение: те же слова стоят в разделе «как начать» и в FAQ.
  await expect(page.getByText("No self-serve checkout yet", { exact: true })).toBeVisible();
});
