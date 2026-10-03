import { expect, test } from "@playwright/test";

/**
 * Заголовки безопасности — проверяются на том, что сервер реально отдаёт,
 * а не на настройке: до запуска их не было вовсе.
 */

test("every page refuses to be framed and pins HTTPS", async ({ request }) => {
  for (const path of ["/", "/login", "/signup"]) {
    const response = await request.get(path);
    const headers = response.headers();

    expect(headers["x-frame-options"], path).toBe("DENY");
    expect(headers["content-security-policy"], path).toContain("frame-ancestors 'none'");
    expect(headers["strict-transport-security"], path).toContain("max-age=");
    expect(headers["x-content-type-options"], path).toBe("nosniff");
  }
});

test("a client report never hands its token to the next site", async ({ request }) => {
  // Токен в адресе открывает отчёт без входа. Несуществующий отчёт тоже
  // должен нести заголовок — он ставится по пути, а не по содержимому.
  const response = await request.get("/r/not-a-real-token");
  expect(response.headers()["referrer-policy"]).toBe("no-referrer");
});

test("stored files other than logos are not served without sign-in", async ({ request }) => {
  const id = "0d51eb9d-a794-4c74-9c09-10d3bc323527";
  for (const key of [`runs/${id}/${id}.txt`, `reports/${id}.pdf`]) {
    expect((await request.get(`/api/files/${key}`)).status(), key).toBe(404);
  }
});
