/**
 * @repo/pipeline — измерительный конвейер: прогон, разбор, агрегация.
 *
 * Живёт отдельным пакетом, потому что нужен обоим приложениям: воркеру
 * для прогонов по расписанию и web для ручного запуска. Дублировать
 * оркестрацию нельзя — это единственное место, где решается, сколько
 * вызовов уйдёт к платформам и что попадёт в метрику.
 */

export { orchestrateRun, executeRunJob, planRunJobs } from "./run-orchestration";
export type { RunJobSpec, RunOutcome } from "./run-orchestration";
export { parseRun, parseStoredResponse, storeCitations } from "./parse-job";
export type { ParseOutcome } from "./parse-job";
export { aggregateClient } from "./aggregate-job";
export { storage, rawResponseKey } from "./storage";
export { classifyRunSources } from "./classify-sources";
export type { ClassifyOutcome } from "./classify-sources";
export { detectExperimentEvents } from "./experiment-events";
export { completeRun } from "./complete-run";
export type { CompleteRunOutcome } from "./complete-run";
export { finalizeRun } from "./finalize-run";
export type { FinalizeRunOutcome } from "./finalize-run";
export { generateOpportunities } from "./opportunity-job";
export type { GenerateOpportunitiesOutcome } from "./opportunity-job";
export { refreshOpportunities } from "./refresh-opportunities";
export { clientVisibility, clientSources, toCitationFacts, PRESENCE_CAVEAT } from "./read-models";
export {
  entitlementsForAgency,
  measurementAllowedForAgency,
  startRunIfAllowed,
  type StartRunResult,
} from "./entitlements";
