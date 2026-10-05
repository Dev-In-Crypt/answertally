import { describe, expect, it } from "vitest";
import { formatDay, formatDayShort, formatPeriod } from "./dates";

describe("даты", () => {
  it("день словом, без двусмысленных чисел", () => {
    expect(formatDay("2026-11-04")).toBe("4 Nov 2026");
    expect(formatDay(new Date("2026-10-04T23:30:00.000Z"))).toBe("4 Oct 2026");
    expect(formatDayShort("2026-10-04")).toBe("4 Oct");
  });

  it("период: год один раз, если он общий", () => {
    expect(formatPeriod("2026-09-04", "2026-10-04")).toBe("4 Sep – 4 Oct 2026");
    expect(formatPeriod("2025-12-20", "2026-01-19")).toBe("20 Dec 2025 – 19 Jan 2026");
  });
});
