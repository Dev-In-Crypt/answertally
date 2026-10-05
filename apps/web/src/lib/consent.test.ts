import { describe, expect, it } from "vitest";
import { adVendors, pickId } from "@/config/tracking";
import { parseConsent } from "./consent";

describe("согласие на рекламные метки", () => {
  it("только явный выбор считается выбором", () => {
    expect(parseConsent("granted")).toBe("granted");
    expect(parseConsent("denied")).toBe("denied");
    expect(parseConsent(null)).toBeNull();
    expect(parseConsent("")).toBeNull();
    expect(parseConsent("yes")).toBeNull();
  });
});

describe("идентификаторы меток", () => {
  it("неверный формат равен «не задано»", () => {
    expect(pickId("AW-1234567890", /^AW-\d{6,}$/)).toBe("AW-1234567890");
    expect(pickId(" AW-1234567890 ", /^AW-\d{6,}$/)).toBe("AW-1234567890");
    expect(pickId("AW-12", /^AW-\d{6,}$/)).toBeNull();
    expect(pickId('1"><script>', /^\d{8,20}$/)).toBeNull();
    expect(pickId(undefined, /^\d+$/)).toBeNull();
  });

  it("получатели данных называются по заданным меткам", () => {
    const base = {
      googleAdsId: null,
      googleSignupLabel: null,
      metaPixelId: null,
      linkedinPartnerId: null,
      linkedinSignupConversionId: null,
    };
    expect(adVendors(base)).toEqual([]);
    expect(adVendors({ ...base, metaPixelId: "12345678", linkedinPartnerId: "123456" })).toEqual([
      "Meta",
      "LinkedIn",
    ]);
  });
});
