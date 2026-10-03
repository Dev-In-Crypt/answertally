import { describe, expect, it } from "vitest";
import { PUBLIC_FILE_HEADERS, publicFileType } from "./public-files";

/**
 * Маршрут файлов открыт без входа. Раньше он отдавал всё хранилище — и
 * сырые ответы ассистентов про клиентов, и напечатанные отчёты, — любому,
 * кто знает путь.
 */

const AGENCY = "0d51eb9d-a794-4c74-9c09-10d3bc323527";

describe("что отдаётся без входа", () => {
  it("логотип агентства — да, с типом по расширению", () => {
    expect(publicFileType(`agencies/${AGENCY}/logo.png`)).toBe("image/png");
    expect(publicFileType(`agencies/${AGENCY}/logo.svg`)).toBe("image/svg+xml");
  });

  it("сырые ответы ассистентов — нет", () => {
    expect(publicFileType(`runs/${AGENCY}/${AGENCY}.txt`)).toBeNull();
  });

  it("напечатанные отчёты — нет", () => {
    expect(publicFileType(`reports/${AGENCY}.pdf`)).toBeNull();
  });

  it("обходные пути — нет", () => {
    expect(publicFileType(`agencies/${AGENCY}/../../runs/x/logo.png`)).toBeNull();
    expect(publicFileType(`agencies/${AGENCY}/logo.png.meta`)).toBeNull();
    expect(publicFileType(`agencies/not-a-uuid/logo.png`)).toBeNull();
    expect(publicFileType(`agencies/${AGENCY}/logo.html`)).toBeNull();
  });

  it("скрипты в SVG не исполнятся даже по прямой ссылке", () => {
    expect(PUBLIC_FILE_HEADERS["Content-Security-Policy"]).toContain("sandbox");
    expect(PUBLIC_FILE_HEADERS["X-Content-Type-Options"]).toBe("nosniff");
  });
});
