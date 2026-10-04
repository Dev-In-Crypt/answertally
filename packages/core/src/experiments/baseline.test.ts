import { describe, expect, it } from "vitest";
import {
  averageVisibility,
  BASELINE_WINDOW_DAYS,
  baselineWindow,
  EXPERIMENT_WARNINGS,
  experimentSnapshots,
  planExperiment,
} from "./baseline";
import type { SnapshotPoint } from "./baseline";

const ACTION_DATE = new Date("2026-08-31T00:00:00Z");

function snapshot(overrides: Partial<SnapshotPoint> = {}): SnapshotPoint {
  return {
    clusterId: "treatment",
    periodStart: new Date("2026-08-10T00:00:00Z"),
    clientVisibilityPct: 20,
    sampleCount: 10,
    ...overrides,
  };
}

describe("baselineWindow", () => {
  it("окно заканчивается датой действия и длится 28 дней", () => {
    const window = baselineWindow(ACTION_DATE);

    expect(window.end.toISOString()).toBe("2026-08-31T00:00:00.000Z");
    expect(window.start.toISOString()).toBe("2026-08-03T00:00:00.000Z");
  });

  it("длина окна настраивается", () => {
    expect(baselineWindow(ACTION_DATE, 14).start.toISOString()).toBe("2026-08-17T00:00:00.000Z");
  });
});

describe("averageVisibility", () => {
  const window = baselineWindow(ACTION_DATE);

  it("средняя взвешена числом ответов, а не срезов", () => {
    const points = [
      snapshot({ clientVisibilityPct: 10, sampleCount: 90 }),
      snapshot({
        periodStart: new Date("2026-08-17T00:00:00Z"),
        clientVisibilityPct: 100,
        sampleCount: 10,
      }),
    ];

    // Простое среднее дало бы 55%; взвешенное — 19%.
    // Неделя с тремя ответами не должна весить как неделя с сотней.
    expect(averageVisibility(points, ["treatment"], window).visibilityPct).toBe(19);
  });

  it("срезы вне окна игнорируются", () => {
    const points = [
      snapshot({ periodStart: new Date("2026-07-01T00:00:00Z"), clientVisibilityPct: 90 }),
      snapshot({ clientVisibilityPct: 20 }),
    ];

    expect(averageVisibility(points, ["treatment"], window).visibilityPct).toBe(20);
  });

  it("срез в день действия не попадает в «до»", () => {
    // Граница полуоткрыта: день действия относится к «после».
    const points = [snapshot({ periodStart: ACTION_DATE, clientVisibilityPct: 90 })];
    expect(averageVisibility(points, ["treatment"], window).visibilityPct).toBeNull();
  });

  it("свёртки по всем кластерам не смешиваются с кластерными срезами", () => {
    const points = [
      snapshot({ clusterId: null, clientVisibilityPct: 90 }),
      snapshot({ clusterId: "treatment", clientVisibilityPct: 20 }),
    ];

    expect(averageVisibility(points, ["treatment"], window).visibilityPct).toBe(20);
  });

  it("пустая группа даёт null, а не ноль", () => {
    // Ноль читался бы как «клиента не упоминают», хотя правда — «мы не мерили».
    const result = averageVisibility([], ["treatment"], window);
    expect(result.visibilityPct).toBeNull();
    expect(result.sufficient).toBe(false);
  });

  it("одного среза мало для baseline", () => {
    const result = averageVisibility([snapshot()], ["treatment"], window);
    expect(result.visibilityPct).toBe(20);
    expect(result.sufficient).toBe(false);
  });

  it("двух срезов достаточно", () => {
    const result = averageVisibility(
      [snapshot(), snapshot({ periodStart: new Date("2026-08-17T00:00:00Z") })],
      ["treatment"],
      window,
    );
    expect(result.sufficient).toBe(true);
  });
});

describe("planExperiment", () => {
  const snapshots = [
    snapshot({ clusterId: "treatment", clientVisibilityPct: 18, sampleCount: 20 }),
    snapshot({
      clusterId: "treatment",
      periodStart: new Date("2026-08-17T00:00:00Z"),
      clientVisibilityPct: 18,
      sampleCount: 20,
    }),
    snapshot({ clusterId: "control", clientVisibilityPct: 21, sampleCount: 20 }),
    snapshot({
      clusterId: "control",
      periodStart: new Date("2026-08-17T00:00:00Z"),
      clientVisibilityPct: 21,
      sampleCount: 20,
    }),
  ];

  it("контрольная группа — кластеры, которых действие не касалось", () => {
    const plan = planExperiment(ACTION_DATE, ["treatment", "control"], ["treatment"], snapshots);

    expect(plan.controlClusterIds).toEqual(["control"]);
    expect(plan.treatment.visibilityPct).toBe(18);
    expect(plan.control.visibilityPct).toBe(21);
    expect(plan.warnings).toEqual([]);
  });

  it("единственный кластер означает отсутствие контроля — и это сказано вслух", () => {
    const plan = planExperiment(ACTION_DATE, ["treatment"], ["treatment"], snapshots);

    // Спек предупреждает ровно об этом: у клиента один сайт и один бренд,
    // настоящей контрольной группы не существует.
    expect(plan.controlClusterIds).toEqual([]);
    expect(plan.warnings).toContain(EXPERIMENT_WARNINGS.noControl);
  });

  it("тонкий baseline помечается предупреждением", () => {
    const plan = planExperiment(
      ACTION_DATE,
      ["treatment", "control"],
      ["treatment"],
      [snapshot({ clusterId: "treatment" }), snapshot({ clusterId: "control" })],
    );

    expect(plan.warnings).toContain(EXPERIMENT_WARNINGS.thinBaseline);
  });

  it("отсутствие измерений до действия названо прямо", () => {
    const plan = planExperiment(ACTION_DATE, ["treatment", "control"], ["treatment"], []);

    expect(plan.warnings).toContain(EXPERIMENT_WARNINGS.noBaseline);
    expect(plan.treatment.visibilityPct).toBeNull();
  });

  it("окно по умолчанию — четыре недельных среза", () => {
    const plan = planExperiment(ACTION_DATE, ["treatment"], ["treatment"], snapshots);
    const days = (plan.window.end.getTime() - plan.window.start.getTime()) / (24 * 60 * 60 * 1000);

    expect(days).toBe(BASELINE_WINDOW_DAYS);
  });
});

describe("experimentSnapshots", () => {
  const week = new Date("2026-08-10T00:00:00Z");
  const row = (clusterId: string | null, platform: string | null) => ({
    clusterId,
    platform,
    periodStart: week,
    clientVisibilityPct: "50.0",
    sampleCount: 3,
  });

  it("берёт только свёртку кластера по всем платформам — ответы не удваиваются", () => {
    // Одна неделя, один кластер, две платформы по 3 ответа = 6 ответов.
    const rows = [
      row("treatment", "chatgpt"),
      row("treatment", "perplexity"),
      { ...row("treatment", null), sampleCount: 6 },
      row(null, "chatgpt"),
      { ...row(null, null), sampleCount: 6 },
    ];

    const points = experimentSnapshots(rows);
    expect(points).toHaveLength(1);
    expect(points[0]?.clientVisibilityPct).toBe(50);

    const result = averageVisibility(points, ["treatment"], baselineWindow(ACTION_DATE));
    expect(result.samples).toBe(6);
    // Одна неделя — один срез: тонкий baseline остаётся тонким.
    expect(result.snapshots).toBe(1);
    expect(result.sufficient).toBe(false);
  });
});
