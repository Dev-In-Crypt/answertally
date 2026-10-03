import { describe, expect, it } from "vitest";
import { requiresEmailVerification } from "./email-verification";

/**
 * Подтверждение адреса требуется только там, где письма действительно уходят.
 *
 * В режиме лога ссылка подтверждения попадает в журнал сервера. Требовать её
 * там значит закрыть регистрацию наглухо всякому, кто поднял продукт без
 * ключа Resend, — а остальное в продукте без ключей деградирует безопасно.
 */

describe("requiresEmailVerification", () => {
  it("требует, когда почта настоящая", () => {
    expect(requiresEmailVerification({ EMAIL_MODE: "live" })).toBe(true);
  });

  it("не требует, когда письма идут в лог", () => {
    expect(requiresEmailVerification({ EMAIL_MODE: "log" })).toBe(false);
    // Умолчание — лог: пустое значение не должно закрывать регистрацию.
    expect(requiresEmailVerification({})).toBe(false);
    expect(requiresEmailVerification({ EMAIL_MODE: "  " })).toBe(false);
  });

  it("требует всегда, когда адаптеры живые — даже с почтой в логе", () => {
    // Живые адаптеры — наши деньги на каждый бесплатный аудит. Забытый
    // EMAIL_MODE на боевом сервере не должен тихо выключать подтверждение.
    expect(requiresEmailVerification({ EMAIL_MODE: "log", ADAPTERS_MODE: "live" })).toBe(true);
    expect(requiresEmailVerification({ ADAPTERS_MODE: "mock" })).toBe(false);
  });

  it("на бессмысленном значении падает, а не выбирает за человека", () => {
    // Молча истолковать «maybe» как «нет» значит оставить регистрацию
    // открытой у того, кто думал, что закрыл её.
    expect(() => requiresEmailVerification({ EMAIL_MODE: "maybe" })).toThrow(/EMAIL_MODE/);
  });
});
