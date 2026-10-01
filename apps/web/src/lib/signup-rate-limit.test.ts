import { describe, expect, it } from "vitest";
import { SIGNUP_RATE_LIMIT } from "./auth";

/**
 * Регистрация — единственный наш расход без верхней границы: подтверждения
 * почты нет, аккаунт заводится на любой адрес, и каждый даёт 250 живых
 * проверок.
 *
 * Тест закрепляет не число, а порядок: окно считается часами, а не
 * секундами. Умолчание Better Auth — 3 за 10 секунд, и если правило
 * однажды уберут, лимит молча вернётся к тысяче аккаунтов в час.
 */

describe("лимит регистраций", () => {
  it("считает окно часами, а не секундами", () => {
    expect(SIGNUP_RATE_LIMIT.window).toBeGreaterThanOrEqual(3600);
  });

  it("пропускает единицы аккаунтов за окно, а не десятки", () => {
    expect(SIGNUP_RATE_LIMIT.max).toBeLessThanOrEqual(5);
    // Ноль закрыл бы регистрацию совсем, и это тоже надо заметить.
    expect(SIGNUP_RATE_LIMIT.max).toBeGreaterThan(0);
  });

  it("за час пропускает меньше десяти аккаунтов с одного адреса", () => {
    // Умолчание Better Auth даёт 1080. Проверяется следствие, а не константы.
    const perHour = (3600 / SIGNUP_RATE_LIMIT.window) * SIGNUP_RATE_LIMIT.max;
    expect(perHour).toBeLessThan(10);
  });
});
