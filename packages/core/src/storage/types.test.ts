import { describe, expect, it } from "vitest";
import { logoKey, MAX_LOGO_BYTES, sniffImageType, validateLogoUpload } from "./types";

describe("validateLogoUpload", () => {
  const cases: [string, number, boolean][] = [
    ["image/png", 1024, true],
    ["image/jpeg", 1024, true],
    ["image/svg+xml", 1024, true],
    ["image/webp", 1024, true],
    ["application/pdf", 1024, false],
    ["text/html", 1024, false],
    ["image/png", 0, false],
    ["image/png", MAX_LOGO_BYTES, true],
    ["image/png", MAX_LOGO_BYTES + 1, false],
  ];

  it.each(cases)("%s размером %i байт -> ok=%s", (contentType, size, expected) => {
    expect(validateLogoUpload(contentType, size).ok).toBe(expected);
  });

  it("отклонённая загрузка объясняет причину", () => {
    expect(validateLogoUpload("application/pdf", 10).error).toBeTruthy();
  });
});

describe("logoKey", () => {
  it("изолирует файлы по агентству", () => {
    expect(logoKey("agency-1", "png")).toBe("agencies/agency-1/logo.png");
    expect(logoKey("agency-2", "png")).not.toBe(logoKey("agency-1", "png"));
  });
});

describe("sniffImageType", () => {
  const bytes = (...values: number[]) => new Uint8Array(values);
  const text = (value: string) => new TextEncoder().encode(value);

  it("узнаёт форматы по первым байтам", () => {
    expect(sniffImageType(bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0))).toBe(
      "image/png",
    );
    expect(sniffImageType(bytes(0xff, 0xd8, 0xff, 0xe0))).toBe("image/jpeg");
    expect(sniffImageType(bytes(0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50))).toBe(
      "image/webp",
    );
    expect(sniffImageType(text('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toBe("image/svg+xml");
    expect(sniffImageType(text('<?xml version="1.0"?><svg/>'))).toBe("image/svg+xml");
    expect(sniffImageType(text("<!-- Generator: Figma --><svg/>"))).toBe("image/svg+xml");
    expect(sniffImageType(text("<!DOCTYPE svg><svg/>"))).toBe("image/svg+xml");
  });

  it("что угодно другое под видом картинки не проходит", () => {
    // Тип из формы задаёт загружающий — верить ему нельзя.
    expect(sniffImageType(text("%PDF-1.4 fake"))).toBeNull();
    expect(sniffImageType(text("<html><script>alert(1)</script></html>"))).toBeNull();
    expect(sniffImageType(bytes())).toBeNull();
  });
});
