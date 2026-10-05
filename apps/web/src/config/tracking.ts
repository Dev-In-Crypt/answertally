/**
 * Рекламные метки — Google Ads, Meta (Facebook, Instagram), LinkedIn.
 *
 * Идентификаторы задаются переменными репозитория и попадают в бандл на
 * сборке. Пока их нет, метки не грузятся, баннер согласия не показывается, а
 * страница о куках говорит «ничего не ставим». Неверный по формату
 * идентификатор считается незаданным: опечатка не должна становиться
 * чужим скриптом на странице.
 *
 * Метки живут только на витрине. На странице клиентского отчёта и внутри
 * продукта их нет и быть не может (белая этикетка, инвариант 3).
 */

/** Значение, прошедшее проверку формата, или null. */
export function pickId(value: string | undefined, pattern: RegExp): string | null {
  const trimmed = value?.trim();
  return trimmed && pattern.test(trimmed) ? trimmed : null;
}

export interface TrackingConfig {
  googleAdsId: string | null;
  googleSignupLabel: string | null;
  metaPixelId: string | null;
  linkedinPartnerId: string | null;
  linkedinSignupConversionId: string | null;
}

// Имена читаются литералами: Next подставляет значения на сборке только так.
export const TRACKING: TrackingConfig = {
  googleAdsId: pickId(process.env.NEXT_PUBLIC_GOOGLE_ADS_ID, /^AW-\d{6,}$/),
  googleSignupLabel: pickId(process.env.NEXT_PUBLIC_GOOGLE_ADS_SIGNUP_LABEL, /^[\w-]{6,}$/),
  metaPixelId: pickId(process.env.NEXT_PUBLIC_META_PIXEL_ID, /^\d{8,20}$/),
  linkedinPartnerId: pickId(process.env.NEXT_PUBLIC_LINKEDIN_PARTNER_ID, /^\d{5,}$/),
  linkedinSignupConversionId: pickId(
    process.env.NEXT_PUBLIC_LINKEDIN_SIGNUP_CONVERSION_ID,
    /^\d{5,}$/,
  ),
};

export const TRACKING_ENABLED = Boolean(
  TRACKING.googleAdsId || TRACKING.metaPixelId || TRACKING.linkedinPartnerId,
);

/** Кто получит данные после согласия — для баннера и юридических страниц. */
export function adVendors(config: TrackingConfig = TRACKING): string[] {
  return [
    config.googleAdsId ? "Google" : null,
    config.metaPixelId ? "Meta" : null,
    config.linkedinPartnerId ? "LinkedIn" : null,
  ].filter((name): name is string => name !== null);
}
