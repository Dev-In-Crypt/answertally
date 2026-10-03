import { describe, expect, it } from "vitest";
import { canonicalEmail, isDisposableEmail } from "./email";

/** Один ящик — один бесплатный аудит: варианты адреса схлопываются. */
const CANONICAL_CASES: [string, string][] = [
  ["Ab@Gmail.com", "ab@gmail.com"],
  ["a.b@gmail.com", "ab@gmail.com"],
  ["a.b+promo@gmail.com", "ab@gmail.com"],
  ["ab@googlemail.com", "ab@gmail.com"],
  // У остальных почт точка значима, а метка — нет.
  ["a.b@agency.com", "a.b@agency.com"],
  ["a.b+x@agency.com", "a.b@agency.com"],
  ["  Owner@Agency.COM ", "owner@agency.com"],
];

describe("canonicalEmail", () => {
  it.each(CANONICAL_CASES)("%s → %s", (input, expected) => {
    expect(canonicalEmail(input)).toBe(expected);
  });
});

describe("isDisposableEmail", () => {
  it("узнаёт одноразовые ящики без учёта регистра", () => {
    expect(isDisposableEmail("x@mailinator.com")).toBe(true);
    expect(isDisposableEmail("x@YOPMAIL.com")).toBe(true);
  });

  it("обычные адреса пропускает", () => {
    expect(isDisposableEmail("owner@agency.com")).toBe(false);
    expect(isDisposableEmail("someone@gmail.com")).toBe(false);
  });
});
