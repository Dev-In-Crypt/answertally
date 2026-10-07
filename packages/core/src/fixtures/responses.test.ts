import { describe, expect, it } from "vitest";
import { adapterResultSchema, PLATFORMS } from "../adapters/types";
import { classifySource, HeuristicSourceClassifier } from "../sources/classifier";
import { normalizeDomain } from "../sources/domains";
import { allFixtures, fixturesForPlatform, RESPONSE_FIXTURES } from "./responses";

/** Verify T11: fixtures валидируются против контракта C1 и покрывают edge-cases. */

describe("response fixtures", () => {
  it.each(RESPONSE_FIXTURES)("$id соответствует AdapterResult", (fixture) => {
    expect(() => adapterResultSchema.parse(fixture.result)).not.toThrow();
  });

  it.each([...PLATFORMS])("для %s есть минимум 3 ответа", (platform) => {
    expect(fixturesForPlatform(platform).length).toBeGreaterThanOrEqual(3);
  });

  it("покрывает все обязательные случаи", () => {
    const covered = new Set(RESPONSE_FIXTURES.map((f) => f.covers));
    expect(covered).toContain("brand-mentioned");
    expect(covered).toContain("brand-alias-only");
    expect(covered).toContain("brand-absent");
    expect(covered).toContain("no-citations");
  });

  it("идентификаторы уникальны", () => {
    const ids = RESPONSE_FIXTURES.map((f) => f.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("случай brand-absent действительно не содержит бренда клиента ни в одном написании", () => {
    const aliases = ["acmecrm", "acme crm", "acme"];

    for (const fixture of RESPONSE_FIXTURES.filter((f) => f.covers === "brand-absent")) {
      const haystack = fixture.result.text.toLowerCase();
      for (const alias of aliases) {
        expect(haystack.includes(alias)).toBe(false);
      }
    }
  });

  it("случай brand-alias-only не содержит каноничного написания", () => {
    for (const fixture of RESPONSE_FIXTURES.filter((f) => f.covers === "brand-alias-only")) {
      expect(fixture.result.text.includes("AcmeCRM")).toBe(false);
      expect(fixture.result.text.toLowerCase()).toContain("acme");
    }
  });

  it("ответ без citations действительно пуст по ссылкам", () => {
    const noCitations = RESPONSE_FIXTURES.filter((f) => f.covers === "no-citations");
    expect(noCitations.length).toBeGreaterThan(0);
    for (const fixture of noCitations) {
      expect(fixture.result.citations).toHaveLength(0);
    }
  });

  it("во всех ответах указана стоимость и версия модели", () => {
    for (const fixture of RESPONSE_FIXTURES) {
      // Инвариант 6: model_version и cost_usd пишутся на каждый response.
      expect(fixture.result.modelVersion).not.toBe("");
      expect(fixture.result.costUsd).toBeGreaterThan(0);
    }
  });
});

/**
 * Ни одного настоящего домена в демо-данных.
 *
 * Рядом с доменом в этих ответах стоит выдуманная доля упоминаний выдуманного
 * бренда. На настоящем домене это превращается в утверждение о компании,
 * которую мы никогда не измеряли, — и оно видно покупателю на публичной
 * странице примера. Зоны `.example` и `.test` зарезервированы RFC 2606 и не
 * регистрируются, поэтому домен из них не может однажды оказаться чьим-то.
 */
describe("домены в fixtures", () => {
  /**
   * Похожее на домен: несколько меток через точку, последняя — буквенная.
   * Ищется во всём тексте ответов, а не только в url: «monday.com» посреди
   * предложения — такой же настоящий домен, как и в ссылке.
   */
  const DOMAIN_LIKE = /\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b/gi;
  const RESERVED = [".example", ".test"];

  it("все домены — в зарезервированных зонах", () => {
    const found = [...JSON.stringify(allFixtures()).matchAll(DOMAIN_LIKE)].map((m) => m[0]);

    expect(found.length).toBeGreaterThan(0);
    const real = found.filter(
      (domain) => !RESERVED.some((zone) => domain.toLowerCase().endsWith(zone)),
    );
    expect([...new Set(real)]).toEqual([]);
  });

  it("не осталось площадок, названных именем настоящей компании", () => {
    // Список ровно тех, что стояли здесь раньше: тест должен падать,
    // если какая-то из них вернётся под другим написанием.
    const realNames = [
      "g2",
      "capterra",
      "trustradius",
      "softwareadvice",
      "reddit",
      "hubspot",
      "pipedrive",
      "forbes",
      "monday.com",
    ];
    const haystack = JSON.stringify(allFixtures()).toLowerCase();

    for (const name of realNames) {
      expect(haystack.includes(`${name}.`)).toBe(false);
    }
  });

  /**
   * Замена доменов не должна была сдвинуть данные: типы источников считает
   * тот же классификатор, что и в бою, и распределение по типам обязано
   * остаться прежним — иначе демо-экраны показывают уже другую картину.
   */
  it("распределение источников по типам не изменилось", async () => {
    const classifier = new HeuristicSourceClassifier();
    const counts = new Map<string, number>();

    for (const fixture of allFixtures()) {
      // Клиент выбирается так же, как в seed: у spend-набора свой.
      const clientDomain = fixture.id.includes("spend") ? "ledgerbrook.test" : "acmecrm.test";

      for (const citation of fixture.result.citations) {
        const { type } = await classifySource(normalizeDomain(citation.url), classifier, {
          clientDomain,
          ...(citation.title ? { title: citation.title } : {}),
        });
        const key = type ?? "unclassified";
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
    }

    expect(Object.fromEntries([...counts].sort())).toEqual({
      // Выросло 07.10.2026: появились заготовки для поверхностей Google.
      documentation: 6,
      editorial: 10,
      owned: 26,
      review: 60,
      ugc: 13,
      unclassified: 74,
    });
  });
});
