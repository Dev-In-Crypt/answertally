import Script from "next/script";
import { UMAMI } from "@/config/tracking";

/**
 * Счётчик Umami (stats.answertally.com): без cookies и без персональных
 * данных, поэтому без баннера согласия. Только витрина и кабинет — на
 * клиентском отчёте его нет (белая этикетка, инвариант 3). Без ID сайта
 * ничего не грузится.
 */
export function Analytics() {
  if (!UMAMI.websiteId) return null;
  return <Script defer src={UMAMI.src} data-website-id={UMAMI.websiteId} strategy="afterInteractive" />;
}
