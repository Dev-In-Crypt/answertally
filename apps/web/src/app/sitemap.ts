import type { MetadataRoute } from "next";
import { SITE_URL } from "@/config/site";

/** Публичные страницы сайта. Новая публичная страница добавляется сюда. */
const PAGES = [
  "/",
  "/product",
  "/method",
  "/pricing",
  "/free-audit",
  "/sample-report",
  "/sample-report/audit",
  "/partners",
  "/research",
  "/proposal-template",
  "/legal/terms",
  "/legal/privacy",
  "/legal/refunds",
  "/legal/cookies",
  "/legal/acceptable-use",
  "/legal/dpa",
  "/legal/subprocessors",
];

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.map((path) => ({ url: `${SITE_URL}${path === "/" ? "" : path}` }));
}
