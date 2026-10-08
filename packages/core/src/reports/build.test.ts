import { describe, expect, it } from "vitest";
import { REPORT_COPY } from "../copy";
import { buildReportPayload, formatContributionRange, summariseWork } from "./build";
import { reportPayloadSchema } from "./schema";
import type { ReportInputs } from "./build";
import type { VisibilitySnapshot } from "../metrics/visibility";

function snapshot(pct: number, competitors: Record<string, number> = {}): VisibilitySnapshot {
  return {
    clusterId: null,
    platform: null,
    periodStart: new Date("2026-08-03T00:00:00Z"),
    periodEnd: new Date("2026-08-10T00:00:00Z"),
    clientVisibilityPct: pct,
    competitorVisibility: competitors,
    sampleCount: 30,
    sufficient: true,
  };
}

function inputs(overrides: Partial<ReportInputs> = {}): ReportInputs {
  return {
    clientName: "AcmeCRM",
    periodStart: new Date("2026-08-01T00:00:00Z"),
    periodEnd: new Date("2026-08-31T00:00:00Z"),
    snapshots: [snapshot(23, { HubSpot: 37 }), snapshot(31, { HubSpot: 37 })],
    completedActions: [
      { title: "Refresh A", actionType: "refresh_page" },
      { title: "Refresh B", actionType: "refresh_page" },
      { title: "New page", actionType: "create_page" },
    ],
    newCitedUrls: 3,
    newBrandMentions: 4,
    highestImpact: { title: "CRM alternatives refresh", incrementalPp: 5, confidence: "medium" },
    nextSprint: ["Editorial outreach", "Product page refresh"],
    caveats: [],
    ...overrides,
  };
}

describe("summariseWork", () => {
  it("группирует действия по типу с человекочитаемыми названиями", () => {
    const summary = summariseWork([
      { actionType: "refresh_page" },
      { actionType: "refresh_page" },
      { actionType: "create_page" },
    ]);

    expect(summary).toEqual([
      { label: "Pages refreshed", count: 2 },
      { label: "New pages created", count: 1 },
    ]);
  });

  it("неизвестный тип не теряется", () => {
    expect(summariseWork([{ actionType: "something_new" }])).toEqual([
      { label: "Other work", count: 1 },
    ]);
  });

  it("пустой список даёт пустую сводку", () => {
    expect(summariseWork([])).toEqual([]);
  });
});

describe("formatContributionRange", () => {
  const cases: [number | null, string | null][] = [
    [5, "+3–7 pp"],
    [16, "+11–21 pp"],
    [-10, "−7–13 pp"],
    [null, null],
  ];

  it.each(cases)("%s -> %s", (value, expected) => {
    expect(formatContributionRange(value)).toBe(expected);
  });

  it("всегда диапазон, а не точка", () => {
    // Точное число выглядело бы как измеренная величина, хотя это оценка,
    // которую невозможно проверить на одном клиенте.
    expect(formatContributionRange(16)).toContain("–");
  });
});

describe("buildReportPayload", () => {
  it("payload проходит валидацию схемы", () => {
    expect(() => reportPayloadSchema.parse(buildReportPayload(inputs()))).not.toThrow();
  });

  it("числа совпадают с ручным расчётом", () => {
    const payload = buildReportPayload(inputs());

    expect(payload.visibility).toEqual({ before: 23, after: 31 });
    expect(payload.results.visibilityDeltaPp).toBe(8);
    // Разрыв: 23 − 37 = −14 pp в начале, 31 − 37 = −6 pp в конце.
    expect(payload.competitorGap).toEqual({ before: -14, after: -6 });
  });

  it("вклад подан диапазоном с уровнем уверенности", () => {
    const payload = buildReportPayload(inputs());

    expect(payload.highestImpactAction).toEqual({
      title: "CRM alternatives refresh",
      estimatedContribution: "+3–7 pp",
      confidence: "medium",
    });
  });

  it("без группы сравнения уверенность падает до низкой", () => {
    // Иначе отчёт спорит сам с собой: в оговорках «сравнивать было не с чем»,
    // а под вкладом — «уверенность: средняя», и клиент читает вторую.
    const payload = buildReportPayload(
      inputs({ caveats: [REPORT_COPY.noComparisonGroup] }),
    );

    expect(payload.highestImpactAction?.confidence).toBe("low");
    expect(payload.caveats).toContain(REPORT_COPY.noComparisonGroup);
  });

  it("с группой сравнения уверенность остаётся той, что посчитали", () => {
    expect(buildReportPayload(inputs()).highestImpactAction?.confidence).toBe("medium");
  });

  it("пояснение о природе измерения есть всегда", () => {
    // Клиент должен понимать, что именно измерено, даже если агентство
    // забыло об этом сказать.
    expect(buildReportPayload(inputs()).caveats).toContain(REPORT_COPY.measurementBasis);
  });

  it("переданные оговорки не теряются", () => {
    const payload = buildReportPayload(
      inputs({ caveats: [REPORT_COPY.noComparisonGroup] }),
    );

    expect(payload.caveats).toContain(REPORT_COPY.noComparisonGroup);
    expect(payload.caveats).toContain(REPORT_COPY.measurementBasis);
  });

  it("без измерений отчёт не выдумывает движение", () => {
    const payload = buildReportPayload(inputs({ snapshots: [] }));

    expect(payload.visibility).toEqual({ before: 0, after: 0 });
    expect(payload.results.visibilityDeltaPp).toBe(0);
  });

  it("одно измерение — это начальная точка, а не «без изменений»", () => {
    expect(buildReportPayload(inputs({ snapshots: [snapshot(9)] })).firstMeasurement).toBe(true);
    expect(buildReportPayload(inputs()).firstMeasurement).toBeUndefined();
  });

  it("без эксперимента раздел о вкладе пуст, а не заполнен догадкой", () => {
    const payload = buildReportPayload(inputs({ highestImpact: null }));
    expect(payload.highestImpactAction).toBeNull();
  });

  it("эксперимент без измеренного эффекта не превращается в утверждение", () => {
    const payload = buildReportPayload(
      inputs({
        highestImpact: { title: "Something", incrementalPp: null, confidence: "low" },
      }),
    );

    expect(payload.highestImpactAction).toBeNull();
  });

  it("период отдаётся датами без времени", () => {
    const payload = buildReportPayload(inputs());
    expect(payload.period).toEqual({ start: "2026-08-01", end: "2026-08-31" });
  });
});

describe("данные диаграмм", () => {
  const cell = (assistantId: string, clientVisibilityPct: number) => ({ assistantId, sampleCount: 15, clientVisibilityPct });

  it("доля по ассистентам, конкуренты по убыванию и линия по неделям", () => {
    const both = [cell("chatgpt", 28), cell("perplexity", 34)];
    const payload = buildReportPayload(inputs({ assistantCells: { first: both, last: both } }));

    expect(payload.byAssistant).toEqual([
      { assistant: "chatgpt", sharePct: 28, answers: 15 },
      { assistant: "perplexity", sharePct: 34, answers: 15 },
    ]);
    expect(payload.competitors).toEqual([{ name: "HubSpot", sharePct: 37 }]);
    expect(payload.trend?.map((p) => p.sharePct)).toEqual([23, 31]);
  });

  it("набор ассистентов менялся — линии нет: точки стоят на разных знаменателях", () => {
    const payload = buildReportPayload(
      inputs({ assistantCells: { first: [cell("chatgpt", 20)], last: [cell("chatgpt", 28), cell("perplexity", 34)] } }),
    );

    expect(payload.trend).toBeUndefined();
  });

  it("одна точка — не линия", () => {
    expect(buildReportPayload(inputs({ snapshots: [snapshot(23)] })).trend).toBeUndefined();
  });
});
