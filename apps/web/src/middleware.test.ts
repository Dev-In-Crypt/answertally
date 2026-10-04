import { describe, expect, it } from "vitest";
import { allowedOnReportHost, pagePath } from "./middleware";

/**
 * Что открывается на домене агентства.
 *
 * Проверяется список, а не сам обработчик: обработчик — три строки вокруг
 * этого решения, а цена ошибки именно здесь. Лишний разрешённый путь — это
 * наша витрина на домене агентства, недостающий — сломанный отчёт у клиента.
 */

describe("домен отчётов", () => {
  it("пропускает то, без чего отчёт не открывается", () => {
    for (const path of [
      "/r/abc123",
      "/r/abc123/icon",
      "/_next/static/chunks/main.js",
      "/fonts/Inter-Regular.woff2",
      "/api/files/logo-123.png",
      "/api/trpc/reports.approve",
      "/favicon.ico",
    ]) {
      expect(allowedOnReportHost(path)).toBe(true);
    }
  });

  it("не пропускает ничего нашего", () => {
    // Клиент агентства, набравший этот адрес, не должен увидеть ни витрину,
    // ни вход в продукт, ни чужой отчёт через список.
    for (const path of [
      "/",
      "/pricing",
      "/method",
      "/product",
      "/free-audit",
      "/partners",
      "/login",
      "/signup",
      "/dashboard",
      "/clients",
      "/settings/billing",
      "/sample-report",
      "/api/webhooks/stripe",
      "/api/health",
    ]) {
      expect(allowedOnReportHost(path)).toBe(false);
    }
  });

  it("похожий на разрешённый путь не проходит", () => {
    // Приставка сравнивается целиком: «/reports» не должен пройти как «/r/».
    expect(allowedOnReportHost("/reports")).toBe(false);
    expect(allowedOnReportHost("/rogue")).toBe(false);
    expect(allowedOnReportHost("/fontsize")).toBe(false);
  });
});

describe("адрес страницы для возврата после входа", () => {
  it("хранит путь и query, без хоста и служебного _rsc", () => {
    expect(pagePath(new URL("https://app.example.com/clients/abc?tab=gaps"))).toBe("/clients/abc?tab=gaps");
    expect(pagePath(new URL("https://app.example.com/dashboard?_rsc=1x2y"))).toBe("/dashboard");
    expect(pagePath(new URL("https://app.example.com/reports?_rsc=1&q=a"))).toBe("/reports?q=a");
  });
});
