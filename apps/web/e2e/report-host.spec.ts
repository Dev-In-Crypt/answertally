import { expect, test } from "@playwright/test";

/**
 * Домен агентства отдаёт отчёт и больше ничего.
 *
 * White-label (инвариант 3) держится не только на том, что на странице
 * отчёта нет нашего логотипа. Приложение одно, и по адресу
 * `reports.agency.com/pricing` открылись бы наши тарифы, а по
 * `/login` — вход в продукт: клиент агентства, набравший домен без
 * пути, узнал бы имя поставщика за один щелчок.
 *
 * Решение живёт в `middleware.ts` и разобрано там же юнит-тестом. Здесь
 * проверяется другое: что в собранном приложении middleware действительно
 * стоит на пути запроса и видит хост. Хост подставляется заголовком
 * `x-forwarded-host` — так его передаёт прокси, за которым приложение и
 * работает в бою.
 */

const REPORT_HOST = "client-reports.test";

const asAgencyDomain = { headers: { "x-forwarded-host": REPORT_HOST } };

test("on the agency's domain nothing but the report exists", async ({ request }) => {
  // Витрина, вход и внутренние экраны — 404 без следа поставщика.
  for (const path of ["/", "/pricing", "/method", "/login", "/signup", "/dashboard"]) {
    const response = await request.get(path, asAgencyDomain);

    expect(response.status(), `${path} on the agency domain`).toBe(404);
    const body = await response.text();
    // Именно «нет такой страницы», а не переадресация к нам: редирект
    // показал бы клиенту, куда он попал, и это тот же след поставщика.
    expect(body).not.toContain("Answertally");
    expect(body).not.toContain("answertally");
  }
});

test("the same paths still work on the product's own domain", async ({ request }) => {
  // Иначе «всё закрыто» прошло бы как «закрыто на домене агентства».
  for (const path of ["/", "/pricing", "/login"]) {
    const response = await request.get(path);
    expect(response.status(), `${path} on our own domain`).toBe(200);
  }
});

test("a report link opens on the agency's domain", async ({ request }) => {
  // Несуществующий токен: страница отчёта обязана открыться и сказать, что
  // ссылка не годится. Сам отчёт по живому токену проверяет public-report.
  const response = await request.get("/r/not-a-real-token", asAgencyDomain);

  expect(response.status()).toBe(200);
  const body = await response.text();
  expect(body).toContain("no longer valid");
  expect(body).not.toContain("Answertally");
});

test("static assets the report needs are served on the agency's domain", async ({ request }) => {
  // Шрифт — не украшение: без него страница отчёта приезжает клиенту
  // системным шрифтом, то есть выглядит сломанной.
  const font = await request.get("/fonts/Inter-Regular.woff2", asAgencyDomain);
  expect(font.status()).toBe(200);
});
