import {
  averageVisibility,
  experimentSnapshots,
  findFirstNewCitation,
  findVisibilityChange,
  MIN_SAMPLES_AFTER,
} from "@repo/core";
import {
  addExperimentEvent,
  hasExperimentEvent,
  listAllSnapshots,
  listCitationObservations,
  listCollectingExperiments,
  setExperimentStatus,
} from "@repo/db";
import type { Database } from "@repo/db";

/** Верхняя граница открытого интервала «после действия». */
const OPEN_ENDED = new Date("9999-12-31T00:00:00Z");

export interface DetectedEvents {
  experimentId: string;
  firstNewCitation: boolean;
  visibilityChange: boolean;
  /** Данных после действия набралось достаточно, чтобы оценивать результат. */
  becameReady: boolean;
}

/**
 * Дописывает события на таймлайны активных экспериментов клиента.
 *
 * Вызывается после агрегации: свежие срезы уже посчитаны, и можно сравнить
 * «после» с зафиксированным baseline. Идемпотентен — каждое событие
 * записывается один раз, иначе таймлайн превратился бы в поток дублей.
 */
export async function detectExperimentEvents(
  db: Database,
  clientId: string,
): Promise<DetectedEvents[]> {
  const experiments = await listCollectingExperiments(db, clientId);
  if (experiments.length === 0) return [];

  const snapshotRows = await listAllSnapshots(db, clientId);
  const snapshots = experimentSnapshots(snapshotRows);

  const results: DetectedEvents[] = [];

  for (const experiment of experiments) {
    const detected: DetectedEvents = {
      experimentId: experiment.id,
      firstNewCitation: false,
      visibilityChange: false,
      becameReady: false,
    };

    // 1. Источник, которого до действия в измерениях не было.
    if (!(await hasExperimentEvent(db, experiment.id, "first_new_citation"))) {
      const observations = await listCitationObservations(
        db,
        clientId,
        experiment.treatmentClusterIds,
      );
      const finding = findFirstNewCitation(observations, experiment.actionDate);

      if (finding) {
        await addExperimentEvent(db, {
          experimentId: experiment.id,
          type: "first_new_citation",
          occurredAt: finding.observedAt,
          note: finding.domain,
          payload: { domain: finding.domain, daysAfterAction: finding.daysAfterAction },
        });
        detected.firstNewCitation = true;
      }
    }

    // 2. Сдвиг видимости относительно baseline выше порога шума.
    if (!(await hasExperimentEvent(db, experiment.id, "visibility_change"))) {
      const baseline = averageVisibility(snapshots, experiment.treatmentClusterIds, {
        start: experiment.baselineStart,
        end: experiment.baselineEnd,
      });

      const after = averageVisibility(snapshots, experiment.treatmentClusterIds, {
        start: experiment.actionDate,
        // «После» — открытый интервал. Ограничивать его текущим моментом нельзя:
        // при расхождении часов между БД и процессом свежий срез выпал бы из окна.
        end: OPEN_ENDED,
      });

      const change = findVisibilityChange(baseline.visibilityPct, after.visibilityPct);

      if (change) {
        await addExperimentEvent(db, {
          experimentId: experiment.id,
          type: "visibility_change",
          occurredAt: new Date(),
          note: `${change.deltaPp >= 0 ? "+" : ""}${change.deltaPp} pp vs baseline`,
          payload: { ...change },
        });
        detected.visibilityChange = true;
      }
    }

    /**
     * 3. Эксперимент готов к оценке.
     *
     * Не «прошло столько-то недель», а «после действия набралось достаточно
     * ответов»: время само по себе ничего не измеряет. Порог — тот же, по
     * которому математика эксперимента начисляет уверенность, иначе экран
     * звал бы смотреть результат, который сама оценка считает недостоверным.
     */
    const afterAll = averageVisibility(snapshots, experiment.treatmentClusterIds, {
      start: experiment.actionDate,
      end: OPEN_ENDED,
    });

    if (afterAll.samples >= MIN_SAMPLES_AFTER) {
      await setExperimentStatus(db, experiment.id, "ready");
      detected.becameReady = true;
    }

    results.push(detected);
  }

  return results;
}
