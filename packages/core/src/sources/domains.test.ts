import { describe, expect, it } from "vitest";
import {
  classifyDomain,
  isSameOrSubdomain,
  KNOWN_DOMAIN_COUNT,
  normalizeDomain,
} from "./domains";
import type { SourceType } from "./domains";

describe("normalizeDomain", () => {
  const cases: [string, string][] = [
    ["G2.com", "g2.com"],
    ["www.g2.com", "g2.com"],
    ["  WWW.Reddit.com  ", "reddit.com"],
    ["example.com.", "example.com"],
    // Агентство вставляет домен клиента копипастом из адресной строки.
    ["https://agenciapisto.com/", "agenciapisto.com"],
    ["http://www.acme.com", "acme.com"],
    ["https://acme.com/es/servicios?utm_source=x", "acme.com"],
    ["acme.com:3000", "acme.com"],
    ["HTTPS://WWW.Acme.COM/", "acme.com"],
  ];

  it.each(cases)("%s -> %s", (input, expected) => {
    expect(normalizeDomain(input)).toBe(expected);
  });
});

describe("isSameOrSubdomain", () => {
  it("совпадение и поддомены засчитываются", () => {
    expect(isSameOrSubdomain("acmecrm.com", "acmecrm.com")).toBe(true);
    expect(isSameOrSubdomain("blog.acmecrm.com", "acmecrm.com")).toBe(true);
    expect(isSameOrSubdomain("docs.eu.acmecrm.com", "acmecrm.com")).toBe(true);
  });

  it("похожий домен не засчитывается", () => {
    // Классическая ошибка: endsWith без точки принял бы notacmecrm.com за поддомен.
    expect(isSameOrSubdomain("notacmecrm.com", "acmecrm.com")).toBe(false);
    expect(isSameOrSubdomain("acmecrm.com.evil.net", "acmecrm.com")).toBe(false);
  });

  it("пустая база не совпадает ни с чем", () => {
    expect(isSameOrSubdomain("acmecrm.com", "")).toBe(false);
  });
});

describe("classifyDomain — словарь", () => {
  const cases: [string, SourceType][] = [
    ["g2.com", "review"],
    ["www.capterra.com", "review"],
    ["trustradius.com", "review"],
    ["producthunt.com", "directory"],
    ["alternativeto.net", "directory"],
    ["reddit.com", "ugc"],
    ["old.reddit.com", "ugc"],
    ["news.ycombinator.com", "ugc"],
    ["linkedin.com", "social"],
    ["x.com", "social"],
    ["forbes.com", "editorial"],
    ["www.techcrunch.com", "editorial"],
  ];

  it.each(cases)("%s -> %s", (domain, expected) => {
    expect(classifyDomain(domain)).toBe(expected);
  });

  it("словарь не пустой и покрывает основные типы", () => {
    expect(KNOWN_DOMAIN_COUNT).toBeGreaterThan(30);
  });
});

describe("classifyDomain — документация по поддомену", () => {
  const cases: [string, SourceType | null][] = [
    ["docs.stripe.com", "documentation"],
    ["developer.mozilla.org", "documentation"],
    ["api.example.com", "documentation"],
    ["help.example.com", "documentation"],
    // Не поддомен, а сам домен — эвристика не применяется.
    ["docs.com", null],
  ];

  it.each(cases)("%s -> %s", (domain, expected) => {
    expect(classifyDomain(domain)).toBe(expected);
  });
});

describe("classifyDomain — домен клиента", () => {
  const options = { clientDomain: "acmecrm.com" };

  it("собственный домен и поддомены становятся owned", () => {
    expect(classifyDomain("acmecrm.com", options)).toBe("owned");
    expect(classifyDomain("blog.acmecrm.com", options)).toBe("owned");
    expect(classifyDomain("www.acmecrm.com", options)).toBe("owned");
  });

  it("owned важнее эвристики документации", () => {
    // Иначе собственная документация клиента считалась бы чужим источником
    // и попадала бы в «gap», хотя это его же страница.
    expect(classifyDomain("docs.acmecrm.com", options)).toBe("owned");
  });

  it("чужой домен не становится owned из-за похожего написания", () => {
    expect(classifyDomain("notacmecrm.com", options)).toBeNull();
  });
});

describe("classifyDomain — неизвестное", () => {
  it("возвращает null, а не other", () => {
    // null означает «нужен следующий классификатор»; запись в other молча
    // ухудшала бы диагностику, и это было бы незаметно.
    expect(classifyDomain("some-random-blog.example")).toBeNull();
  });

  it("пустая строка не роняет классификатор", () => {
    expect(classifyDomain("")).toBeNull();
    expect(classifyDomain("   ")).toBeNull();
  });
});

describe("normalizeDomain на враждебной строке", () => {
  it("строка из одних «#» не тормозит (было квадратично)", () => {
    const started = Date.now();
    expect(normalizeDomain("#".repeat(200_000))).toBe("");
    expect(Date.now() - started).toBeLessThan(500);
  });
});
