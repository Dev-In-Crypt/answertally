import { describe, expect, it } from "vitest";
import {
  buildAuditProposal,
  competitorAverage,
  estimateMarginPct,
  PROPOSAL_CAVEATS,
  PROPOSAL_DEFAULTS,
} from "./proposal";
import { buildReportPayload } from "./build";
import { reportPayloadSchema } from "./schema";

/** Verify T62: payload аудита валиден и числа сходятся с ручным расчётом. */

const ACTIONS = [
  {
    title: "Get listed on G2",
    reason: "G2 is cited in 16 of 25 answers and the client is absent from it.",
    estimatedImpact: "high" as const,
    effort: "medium" as const,
  },
  {
    title: "Refresh the pricing page",
    reason: "The page is cited but the pricing on it is two years out of date.",
    estimatedImpact: "medium" as const,
    effort: "low" as const,
  },
];

describe("estimateMarginPct", () => {
  it("считает диапазон по краям часов", () => {
    // $3,500 при $85/ч: 8 ч → $680 (80.6%), 12 ч → $1,020 (70.9%).
    expect(estimateMarginPct(3500, { min: 8, max: 12 }, 85)).toEqual({ min: 70.9, max: 80.6 });
  });

  it("больше часов — меньше маржа", () => {
    const cheap = estimateMarginPct(3500, { min: 4, max: 4 }, 85);
    const costly = estimateMarginPct(3500, { min: 20, max: 20 }, 85);
    expect(cheap.min).toBeGreaterThan(costly.min);
  });

  it("убыточное предложение показывается как есть, а не подрезается нулём", () => {
    const margin = estimateMarginPct(500, { min: 10, max: 10 }, 85);
    expect(margin.min).toBeLessThan(0);
  });

  it("нулевой ретейнер — ошибка, а не деление на ноль", () => {
    expect(() => estimateMarginPct(0, { min: 8, max: 12 }, 85)).toThrow(/positive/);
  });
});

describe("competitorAverage", () => {
  it("средняя по конкурентам, а не по лидеру", () => {
    expect(competitorAverage({ HubSpot: 60, Pipedrive: 40, Close: 20 })).toBe(40);
  });

  it("без конкурентов даёт ноль", () => {
    expect(competitorAverage({})).toBe(0);
  });
});

describe("buildAuditProposal", () => {
  it("разрыв считается к средней по конкурентам", () => {
    const opportunity = buildAuditProposal({
      currentVisibilityPct: 22,
      competitorVisibility: { HubSpot: 60, Pipedrive: 40 },
      rankedActions: ACTIONS,
    });

    expect(opportunity.competitorAverageVisibilityPct).toBe(50);
    expect(opportunity.gapPp).toBe(-28);
  });

  it("дефолты берутся из спека", () => {
    const opportunity = buildAuditProposal({
      currentVisibilityPct: 10,
      competitorVisibility: {},
      rankedActions: ACTIONS,
    });

    expect(opportunity.suggestedRetainerUsd).toBe(PROPOSAL_DEFAULTS.retainerUsd);
    expect(opportunity.estimatedEffortHours).toEqual(PROPOSAL_DEFAULTS.effortHours);
    expect(opportunity.scopeDays).toBe(90);
  });

  it("список действий обрезается двадцатью", () => {
    const many = Array.from({ length: 26 }, (_, index) => ({
      title: `Action ${index}`,
      reason: `Reason ${index}`,
      estimatedImpact: "medium" as const,
      effort: "low" as const,
    }));

    expect(buildAuditProposal({
      currentVisibilityPct: 10,
      competitorVisibility: {},
      rankedActions: many,
    }).rankedActions).toHaveLength(20);
  });

  it("перевёрнутый диапазон часов — ошибка", () => {
    expect(() =>
      buildAuditProposal({
        currentVisibilityPct: 10,
        competitorVisibility: {},
        rankedActions: ACTIONS,
        effortHours: { min: 12, max: 8 },
      }),
    ).toThrow(/inverted/);
  });
});

describe("payload аудита", () => {
  const payload = buildReportPayload({
    clientName: "AcmeCRM",
    periodStart: new Date("2026-05-01T00:00:00.000Z"),
    periodEnd: new Date("2026-05-31T00:00:00.000Z"),
    snapshots: [
      {
        clusterId: null,
        platform: null,
        periodStart: new Date("2026-05-01T00:00:00.000Z"),
        periodEnd: new Date("2026-05-08T00:00:00.000Z"),
        clientVisibilityPct: 22,
        competitorVisibility: { HubSpot: 60, Pipedrive: 40 },
        sampleCount: 18,
        sufficient: true,
      },
    ],
    completedActions: [],
    newCitedUrls: 0,
    newBrandMentions: 4,
    highestImpact: null,
    nextSprint: [],
    caveats: PROPOSAL_CAVEATS,
    opportunity: buildAuditProposal({
      currentVisibilityPct: 22,
      competitorVisibility: { HubSpot: 60, Pipedrive: 40 },
      rankedActions: ACTIONS,
    }),
  });

  it("валиден по схеме C4", () => {
    expect(() => reportPayloadSchema.parse(payload)).not.toThrow();
  });

  it("несёт раздел аудита с числами из измерений", () => {
    expect(payload.opportunity?.currentVisibilityPct).toBe(22);
    expect(payload.opportunity?.gapPp).toBe(-28);
    expect(payload.opportunity?.rankedActions).toHaveLength(2);
  });

  it("у каждого действия непустая причина — инвариант 7", () => {
    for (const action of payload.opportunity?.rankedActions ?? []) {
      expect(action.reason.trim().length).toBeGreaterThan(0);
    }
  });

  it("оговорки аудита доезжают до клиента вместе с цифрами", () => {
    for (const caveat of PROPOSAL_CAVEATS) {
      expect(payload.caveats).toContain(caveat);
    }
  });

  it("обычный отчёт остаётся без раздела аудита", () => {
    const regular = buildReportPayload({
      clientName: "AcmeCRM",
      periodStart: new Date("2026-05-01T00:00:00.000Z"),
      periodEnd: new Date("2026-05-31T00:00:00.000Z"),
      snapshots: [],
      completedActions: [],
      newCitedUrls: 0,
      newBrandMentions: 0,
      highestImpact: null,
      nextSprint: [],
      caveats: [],
    });

    expect(regular.opportunity).toBeNull();
  });
});

describe("как делается пункт аудита", () => {
  it("тип работы известен — шаги плейбука и как увидеть результат", () => {
    const block = buildAuditProposal({
      currentVisibilityPct: 10,
      competitorVisibility: { A: 30 },
      rankedActions: [
        { title: "Get covered on x.example", reason: "cited", estimatedImpact: "high", effort: "low", actionType: "review_platform", sourceDomain: "x.example" },
        { title: "Manual item", reason: "agency note", estimatedImpact: "low", effort: "low" },
      ],
    });
    const [typed, manual] = block.rankedActions;
    expect(typed?.steps?.length).toBeGreaterThan(0);
    expect(typed?.check?.[0]).toContain("x.example");
    // Внутренние поля в отчёт не уезжают.
    expect(typed).not.toHaveProperty("actionType");
    expect(manual?.steps).toBeUndefined();
  });
});
