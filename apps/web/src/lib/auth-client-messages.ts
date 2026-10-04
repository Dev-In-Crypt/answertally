import { SUPPORT_EMAIL } from "@/config/site";

/**
 * Что показать человеку вместо ответа сервера входа.
 *
 * Better Auth отдаёт тексты для разработчика: «Invalid token», «User already
 * exists. Use another email.», «Too many requests». Каждый такой текст на
 * экране — тупик: непонятно, что делать дальше. Здесь известные коды
 * переводятся в фразу с выходом; наши собственные отказы (хуки в
 * `lib/auth.ts`) уже написаны для человека и проходят как есть.
 *
 * Лежит отдельно от клиента входа: страница входа — серверная, и тянуть в
 * неё клиентский модуль ради этих функций незачем.
 */

export interface AuthClientError {
  code?: string;
  message?: string;
  status: number;
}

export const NETWORK_ERROR_MESSAGE =
  "Can't reach Answertally. Check your connection and try again.";
const GENERIC_ERROR_MESSAGE = `Something went wrong on our side. Try again in a minute, or write to ${SUPPORT_EMAIL}.`;

const BY_CODE: Record<string, string> = {
  INVALID_EMAIL_OR_PASSWORD:
    "That email and password don't match. Try again or reset your password.",
  INVALID_EMAIL: "Enter a valid email address.",
  INVALID_PASSWORD: "Enter your password.",
  PASSWORD_TOO_SHORT: "Use at least 8 characters for the password.",
  PASSWORD_TOO_LONG: "Use a password of at most 128 characters.",
  USER_ALREADY_EXISTS: "An account with this email already exists. Sign in or reset your password.",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL:
    "An account with this email already exists. Sign in or reset your password.",
  INVALID_TOKEN: "This link has expired or was already used. Ask for a new one.",
  TOKEN_EXPIRED: "This link has expired or was already used. Ask for a new one.",
  VALIDATION_ERROR: "Check the fields and try again.",
};

/**
 * Текст ошибки для формы входа, регистрации или сброса пароля.
 *
 * `now` — для лимита регистраций: счётчик на сервере сбрасывается на границе
 * часа (см. `server/rate-limit.ts`), и человеку честнее назвать минуты, чем
 * «попробуйте позже».
 */
export function authErrorMessage(
  error: AuthClientError,
  action: "signup" | "other" = "other",
  now: Date = new Date(),
): string {
  // Сеть: `settled` из клиента входа превращает упавший fetch в `status: 0`.
  if (error.status === 0) return NETWORK_ERROR_MESSAGE;

  if (error.status === 429) {
    if (action === "signup") {
      const minutes = Math.max(1, 60 - now.getUTCMinutes());
      return `Too many sign-up attempts from this network. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}, or write to ${SUPPORT_EMAIL}.`;
    }
    return "Too many attempts. Wait a minute and try again.";
  }

  const known = error.code ? BY_CODE[error.code] : undefined;
  if (known) return known;
  if (error.status >= 500 || !error.message) return GENERIC_ERROR_MESSAGE;
  return error.message;
}

/**
 * Куда вести после входа: только путь внутри нашего же сайта.
 *
 * `?next=` приходит из адресной строки, и без проверки ссылка
 * `/login?next=https://evil.example` уводила бы со страницы входа на чужой
 * сайт. Страницы входа и регистрации тоже отсекаются — вошедшего они
 * отправляют дальше, и цикл не кончился бы.
 */
export function safeNextPath(next: string | null | undefined): string {
  const fallback = "/dashboard";
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\")) {
    return fallback;
  }
  const base = "http://answertally.invalid";
  let url: URL;
  try {
    url = new URL(next, base);
  } catch {
    return fallback;
  }
  if (url.origin !== base) return fallback;
  if (/^\/(login|signup)(\/|$)/.test(url.pathname)) return fallback;
  return `${url.pathname}${url.search}${url.hash}`;
}

/** Ссылка подтверждения не сработала — Better Auth вернул сюда `?error=`. */
export function verificationLinkNotice(code: string): string {
  return code === "TOKEN_EXPIRED"
    ? "That confirmation link has expired. Sign in with your email and password and we'll send a fresh one."
    : "That confirmation link doesn't work any more. Sign in with your email and password — if the address still needs confirming, we'll send a fresh link.";
}
