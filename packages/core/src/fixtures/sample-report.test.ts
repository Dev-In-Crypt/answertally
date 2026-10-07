import { describe, expect, it } from "vitest";
import { REPORT_COPY } from "../copy";
import { reportPayloadSchema } from "../reports/schema";
import {
  SAMPLE_AGENCY,
  SAMPLE_AUDIT_REPORT,
  SAMPLE_DELIVERY_REPORT,
  SAMPLE_HIGHLIGHTS,
} from "./sample-report";

/**
 * Эти данные видит покупатель на публичной странице, поэтому они проверяются
 * как продукт, а не как декорация: числа сверены вручную, а «улучшение»
 * примера выдуманной работой должно ронять тест.
 */

describe("демонстрационный отчёт", () => {
  it("оба отчёта валидны по схеме C4", () => {
    expect(() => reportPayloadSchema.parse(SAMPLE_AUDIT_REPORT)).not.toThrow();
    expect(() => reportPayloadSchema.parse(SAMPLE_DELIVERY_REPORT)).not.toThrow();
  });

  it("логотипа нет — грузить его в сборке неоткуда", () => {
    expect(SAMPLE_AGENCY.logoUrl).toBeNull();
  });

  /**
   * Эту страницу видит покупатель. Строка вида «g2.com процитирован в 18%
   * ответов» рядом с выдуманным брендом — выдуманная цифра, приписанная
   * настоящей компании. Зона `.example` не регистрируется (RFC 2606), поэтому
   * домен из неё не может однажды оказаться чьим-то.
   */
  it("ни одного настоящего домена — все в зоне .example", () => {
    const domainLike = /\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9-]+)*\.[a-z]{2,}\b/gi;
    const text = JSON.stringify([SAMPLE_AUDIT_REPORT, SAMPLE_DELIVERY_REPORT, SAMPLE_AGENCY]);
    const found = [...text.matchAll(domainLike)].map((match) => match[0]);

    expect(found.length).toBeGreaterThan(0);
    expect([...new Set(found.filter((domain) => !domain.endsWith(".example")))]).toEqual([]);
  });
});

describe("отчёт аудита", () => {
  it("разрыв считается к средней по конкурентам", () => {
    // (39.6 + 30.2 + 18.1) / 3 = 29.3; 11.5 − 29.3 = −17.8.
    expect(SAMPLE_AUDIT_REPORT.opportunity?.currentVisibilityPct).toBe(11.5);
    expect(SAMPLE_AUDIT_REPORT.opportunity?.competitorAverageVisibilityPct).toBe(29.3);
    expect(SAMPLE_AUDIT_REPORT.opportunity?.gapPp).toBe(-17.8);
    // Разрыв в шапке отчёта — к лидеру: 11.5 − 39.6.
    expect(SAMPLE_AUDIT_REPORT.competitorGap.before).toBe(-28.1);
  });

  it("работ не сделано; ответы с клиентом сходятся с долей — так его и собирает продукт", () => {
    expect(SAMPLE_AUDIT_REPORT.workCompleted).toEqual([]);
    expect(SAMPLE_AUDIT_REPORT.results.newCitedUrls).toBe(0);
    // «X из N» в отчёте не спорит с долей: раньше здесь был 0 при 11.5%.
    const { newBrandMentions, sampledAnswers } = SAMPLE_AUDIT_REPORT.results;
    expect(Math.round((newBrandMentions / (sampledAnswers ?? 1)) * 1000) / 10).toBe(
      SAMPLE_AUDIT_REPORT.opportunity?.currentVisibilityPct,
    );
    expect(SAMPLE_AUDIT_REPORT.highestImpactAction).toBeNull();
  });

  it("у каждой предложенной работы непустая причина — инвариант 7", () => {
    const actions = SAMPLE_AUDIT_REPORT.opportunity?.rankedActions ?? [];

    expect(actions.length).toBeGreaterThanOrEqual(5);
    for (const action of actions) {
      expect(action.reason.trim().length).toBeGreaterThan(0);
    }
  });

  it("несёт оговорки аудита", () => {
    expect(SAMPLE_AUDIT_REPORT.caveats).toContain(REPORT_COPY.measurementBasis);
    expect(SAMPLE_AUDIT_REPORT.caveats).toContain(REPORT_COPY.opportunityBasis);
    expect(SAMPLE_AUDIT_REPORT.caveats).toContain(REPORT_COPY.scopeEstimate);
  });
});

describe("квартальный отчёт", () => {
  it("движение видимости совпадает с ручным расчётом", () => {
    expect(SAMPLE_DELIVERY_REPORT.visibility).toEqual({ before: 19.4, after: 28.6 });
    expect(SAMPLE_DELIVERY_REPORT.results.visibilityDeltaPp).toBe(9.2);
  });

  it("клиент к концу периода всё ещё позади лидера", () => {
    // 19.4 − 41.2 = −21.8; 28.6 − 42.0 = −13.4.
    expect(SAMPLE_DELIVERY_REPORT.competitorGap).toEqual({ before: -21.8, after: -13.4 });
    expect(SAMPLE_DELIVERY_REPORT.competitorGap.after).toBeLessThan(0);
  });

  it("вклад показан диапазоном и с уровнем уверенности, а не точкой", () => {
    expect(SAMPLE_DELIVERY_REPORT.highestImpactAction?.estimatedContribution).toBe("+2–6 pp");
    expect(SAMPLE_DELIVERY_REPORT.highestImpactAction?.confidence).toBe("low");
  });

  it("сделанная работа сгруппирована по типам", () => {
    expect(SAMPLE_DELIVERY_REPORT.workCompleted).toEqual([
      { label: "Pages refreshed", count: 4 },
      { label: "Source outreach", count: 3 },
      { label: "New pages created", count: 2 },
      { label: "Review platform work", count: 2 },
      { label: "Structured data fixes", count: 1 },
    ]);
  });

  it("показывает собственный предел вместе с цифрами", () => {
    expect(SAMPLE_DELIVERY_REPORT.caveats).toContain(REPORT_COPY.measurementBasis);
    // Вклад действия и «сравнивать было не с чем» вместе — отчёт спорит сам с собой.
    expect(SAMPLE_DELIVERY_REPORT.caveats).not.toContain(REPORT_COPY.noComparisonGroup);
  });
});

describe("числа для витрины", () => {
  it("читаются из самих отчётов, а не переписаны руками", () => {
    expect(SAMPLE_HIGHLIGHTS.deliveryBefore).toBe(SAMPLE_DELIVERY_REPORT.visibility.before);
    expect(SAMPLE_HIGHLIGHTS.deliveryAfter).toBe(SAMPLE_DELIVERY_REPORT.visibility.after);
    expect(SAMPLE_HIGHLIGHTS.auditGapPp).toBe(SAMPLE_AUDIT_REPORT.opportunity?.gapPp);
    expect(SAMPLE_HIGHLIGHTS.deliveryContribution).toBe("+2–6 pp");
    expect(SAMPLE_HIGHLIGHTS.auditActions).toBe(6);
  });
});
