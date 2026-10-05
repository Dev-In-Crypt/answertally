import { TRACKING } from "@/config/tracking";

/**
 * Конверсия «зарегистрировался» для рекламных кабинетов.
 *
 * Функции меток появляются на странице только после согласия, поэтому здесь
 * нет проверки согласия: нет согласия — нет и функции, вызов ничего не делает.
 */

interface TrackingWindow {
  gtag?: (...args: unknown[]) => void;
  fbq?: (...args: unknown[]) => void;
  lintrk?: (...args: unknown[]) => void;
}

export function trackSignup(): void {
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
