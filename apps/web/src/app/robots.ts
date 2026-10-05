import type { MetadataRoute } from "next";
import { SITE_URL } from "@/config/site";

/**
 * Поисковикам — только публичный сайт.
 *
 * Рабочее место агентства закрыто входом, а отчёт клиента отдан по ссылке
 * конкретному человеку: им в выдаче не место. Страница отчёта и так
 * помечена noindex, запрет здесь не даёт тратить на неё обход.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/api/",
        "/r/",
        "/invite/",
        "/dashboard",
        "/clients",
        "/reports",
        "/settings",
        "/reset-password",
      ],
    },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
