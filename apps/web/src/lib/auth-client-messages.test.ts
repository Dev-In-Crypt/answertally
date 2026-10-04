import { describe, expect, it } from "vitest";
import { authErrorMessage, NETWORK_ERROR_MESSAGE, safeNextPath } from "./auth-client-messages";

describe("ошибки форм входа", () => {
  it.each([
    [{ status: 0 }, NETWORK_ERROR_MESSAGE],
    [
      { status: 401, code: "INVALID_EMAIL_OR_PASSWORD", message: "Invalid email or password" },
      /don't match/,
    ],
    [
      { status: 400, code: "INVALID_TOKEN", message: "Invalid token" },
      /expired or was already used/,
    ],
    [
      { status: 403, message: "This account was removed from its workspace." },
      /removed from its workspace/,
    ],
    [{ status: 500, message: 'relation "users" does not exist' }, /Something went wrong/],
    [{ status: 400 }, /Something went wrong/],
  ])("%o → понятная фраза", (error, expected) => {
    const text = authErrorMessage(error);
    if (typeof expected === "string") expect(text).toBe(expected);
    else expect(text).toMatch(expected);
  });

  it("лимит регистраций называет минуты до сброса окна", () => {
    const text = authErrorMessage(
      { status: 429, message: "Too many requests. Please try again later." },
      "signup",
      new Date("2026-10-04T10:45:00Z"),
    );
    expect(text).toContain("15 minutes");
  });
});

describe("адрес после входа", () => {
  it.each([
    [undefined, "/dashboard"],
    ["/clients/abc/reports?tab=sent", "/clients/abc/reports?tab=sent"],
    ["https://evil.example/", "/dashboard"],
    ["//evil.example/", "/dashboard"],
    ["/\\evil.example", "/dashboard"],
    ["javascript:alert(1)", "/dashboard"],
    ["/login?next=/x", "/dashboard"],
    ["/signup", "/dashboard"],
  ])("%s → %s", (next, expected) => {
    expect(safeNextPath(next)).toBe(expected);
  });
});
