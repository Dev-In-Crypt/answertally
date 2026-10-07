/**
 * Cloudflare Turnstile: невидимая проверка «не бот» на регистрации и в
 * предпросмотре вопросов. Каждый бесплатный аудит стоит денег, поэтому
 * пачки регистраций скриптом должны упираться в неё.
 *
 * Без секрета проверка выключена целиком (разработка, e2e): виджет не
 * рисуется, сервер не требует токена. Ключ сайта публичный, секрет — только
 * в окружении сервера.
 */
export function captchaSecret(): string | null {
  return process.env.TURNSTILE_SECRET_KEY?.trim() || null;
}

/** Ключ для виджета — только когда сервер умеет проверить ответ. */
export function captchaSiteKey(): string | null {
  const site = process.env.TURNSTILE_SITE_KEY?.trim();
  return site && captchaSecret() ? site : null;
}

/** Проверка токена у Cloudflare. Сбой связи — отказ: лучше переспросить человека, чем пропустить бота. */
export async function verifyCaptcha(token: string | null, ip: string | undefined): Promise<boolean> {
  const secret = captchaSecret();
  if (!secret) return true;
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret, response: token, ...(ip ? { remoteip: ip } : {}) });
    const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
      signal: AbortSignal.timeout(10_000),
    });
    const result = (await response.json()) as { success?: boolean };
    return result.success === true;
  } catch {
    return false;
  }
}
