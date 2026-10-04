import {
  averageVisibility,
  estimateExperiment,
  experimentSnapshots,
  formatEstimate,
  type ExperimentEstimate,
} from "@repo/core";
import {
  listAllSnapshots,
  listExperimentEvents,
  type Database,
  type Experiment,
} from "@repo/db";

/**
 * Результаты экспериментов клиента — те же, что показывает экран.
 *
 * Одна функция на экран отчёта и на сам отчёт: разойтись им нельзя. Клиент
 * получит документ, в котором написано одно, а агентство будет смотреть на
 * другое, и объяснять это придётся агентству.
 *
 * Ничего не замораживается здесь: оценка — чистая математика над срезами, а
 * срезы меняются с каждым прогоном. Замораживается она ровно один раз — в
 * payload отчёта, в момент его создания.
 */

/** Открытая граница интервала «после»: та же, что в детекте событий. */
const OPEN_ENDED = new Date("9999-12-31T00:00:00Z");

export interface ExperimentOutcome {
  experiment: Experiment;
  estimate: ExperimentEstimate;
  formatted: string;
  /** Хватило ли данных после действия, чтобы вообще что-то читать. */
  readable: boolean;
}

export async function experimentOutcomes(
  db: Database,
  clientId: string,
  experiments: readonly Experiment[],
): Promise<ExperimentOutcome[]> {
  if (experiments.length === 0) return [];

  const snapshotRows = await listAllSnapshots(db, clientId);
  const snapshots = experimentSnapshots(snapshotRows);

  const outcomes: ExperimentOutcome[] = [];

  for (const experiment of experiments) {
    const events = await listExperimentEvents(db, experiment.id);

    const baselineWindow = { start: experiment.baselineStart, end: experiment.baselineEnd };
    const afterWindow = { start: experiment.actionDate, end: OPEN_ENDED };

    const treatmentBefore = averageVisibility(
      snapshots,
      experiment.treatmentClusterIds,
      baselineWindow,
    );
    const treatmentAfter = averageVisibility(snapshots, experiment.treatmentClusterIds, afterWindow);
    const controlBefore = averageVisibility(snapshots, experiment.controlClusterIds, baselineWindow);
    const controlAfter = averageVisibility(snapshots, experiment.controlClusterIds, afterWindow);

    const estimate = estimateExperiment({
      treatmentBefore: treatmentBefore.visibilityPct,
      treatmentAfter: treatmentAfter.visibilityPct,
      controlBefore: controlBefore.visibilityPct,
      controlAfter: controlAfter.visibilityPct,
      treatmentSamplesAfter: treatmentAfter.samples,
      baselineSnapshots: treatmentBefore.snapshots,
      hasControlGroup: experiment.controlClusterIds.length > 0,
      hasNewCitation: events.some((event) => event.type === "first_new_citation"),
    });

    outcomes.push({
      experiment,
      estimate,
      formatted: formatEstimate(estimate),
      // Нечитаемый эксперимент — не «нулевой результат», а отсутствие
      // измерения. В отчёт клиенту такой не идёт вовсе.
      readable: estimate.incrementalPp !== null && treatmentAfter.sufficient,
    });
  }

  return outcomes;
}
