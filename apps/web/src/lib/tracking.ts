import { TRACKING } from "@/config/tracking";

/**
 * Конверсия «зарегистрировался» для рекламных кабинетов.
 *
 * Функции меток появляются на странице только после согласия, поэтому здесь
 * нет проверки согласия: нет согласия — нет и функции, вызов ничего не делает.
 */

/**
 * Шаг воронки в Umami: визит → регистрация → аудит → выбор тарифа → оплата.
 * Нет счётчика — вызов ничего не делает.
 */
export function trackStep(name: "signup" | "audit_started" | "plan_checkout" | "question_preview"): void {
  try {
    (window as unknown as { umami?: { track: (event: string) => void } }).umami?.track(name);
  } catch {
    // Счётчик не должен ломать действие.
  }
}

interface TrackingWindow {
  gtag?: (...args: unknown[]) => void;
  fbq?: (...args: unknown[]) => void;
  lintrk?: (...args: unknown[]) => void;
}

export function trackSignup(): void {
  trackStep("signup");
  const w = window as unknown as TrackingWindow;
  try {
    if (TRACKING.googleAdsId && TRACKING.googleSignupLabel) {
      w.gtag?.("event", "conversion", {
        send_to: `${TRACKING.googleAdsId}/${TRACKING.googleSignupLabel}`,
      });
    }
    w.fbq?.("track", "CompleteRegistration");
    if (TRACKING.linkedinSignupConversionId) {
      w.lintrk?.("track", { conversion_id: Number(TRACKING.linkedinSignupConversionId) });
    }
  } catch {
    // Метка не должна ломать регистрацию.
  }
}
