import { beforeAll, describe, expect, it } from "vitest";
import { createPrintToken, readPrintToken } from "./print-token";

const REPORT_ID = "6f1c1d2e-8a4b-4c3d-9e2f-0a1b2c3d4e5f";

describe("пропуск на печать PDF", () => {
  beforeAll(() => {
    process.env.BETTER_AUTH_SECRET ??= "test-secret-for-print-tokens";
  });

  it("подлинный пропуск открывает свой отчёт", () => {
    expect(readPrintToken(createPrintToken(REPORT_ID))).toBe(REPORT_ID);
  });

  it("истёкший пропуск не открывает ничего", () => {
    const token = createPrintToken(REPORT_ID, Date.now() - 10 * 60_000);
    expect(readPrintToken(token)).toBeNull();
  });

  it("подменённый отчёт или подпись не проходят", () => {
    const token = createPrintToken(REPORT_ID);
    const forged = token.replace(REPORT_ID, "00000000-0000-4000-8000-000000000000");
    expect(readPrintToken(forged)).toBeNull();
    expect(readPrintToken(`${token.slice(0, -2)}xx`)).toBeNull();
  });

  it("клиентская ссылка пропуском не считается", () => {
    expect(readPrintToken("Zm9vYmFyYmF6cXV4cXV1eHF1dXhxdXV4cXV1eHF1dXg")).toBeNull();
  });
});
