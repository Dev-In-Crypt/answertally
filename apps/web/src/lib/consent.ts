/**
 * Выбор человека про рекламные метки.
 *
 * Хранится в localStorage, а не в куке: сам выбор не должен быть кукой,
 * которую приходится отдельно объяснять. Нет записи — выбора не было, и метки
 * не грузятся: молчание не согласие.
 */

export const CONSENT_KEY = "at_consent";
/** Событие, которым подвал просит показать баннер заново. */
export const OPEN_CONSENT_EVENT = "at:open-consent";

export type Consent = "granted" | "denied";

export function parseConsent(raw: string | null | undefined): Consent | null {
  return raw === "granted" || raw === "denied" ? raw : null;
}

export function readConsent(): Consent | null {
  try {
    return parseConsent(window.localStorage.getItem(CONSENT_KEY));
  } catch {
    // Приватный режим запрещает чтение: выбора «нет», метки не грузим.
    return null;
  }
}

export function writeConsent(value: Consent): void {
  try {
    window.localStorage.setItem(CONSENT_KEY, value);
  } catch {
    // Не записалось — баннер появится снова. Это лучше, чем считать молчание согласием.
  }
}
