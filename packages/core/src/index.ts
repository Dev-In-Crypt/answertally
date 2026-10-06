/**
 * @repo/core — чистая бизнес-логика без I/O-фреймворков.
 * Здесь живут контракты C1–C6 (см. TASKS.md): адаптеры платформ, парсинг ответов,
 * метрики visibility, experiment math, схема отчёта, copy-константы.
 */

export const CORE_PACKAGE_NAME = "@repo/core";

export { formatDateTime, formatDay, formatDayShort, formatPeriod } from "./format/dates";

export * from "./adapters/types";
export * from "./adapters/pricing";
export { MockAdapter, stableHash } from "./adapters/mock";
export {
  DEFAULT_OPENAI_MODEL,
  DEFAULT_REASONING_EFFORT,
  OpenAiAdapter,
  OPENAI_PRICING,
  openAiCostUsd,
} from "./adapters/openai";
export type { OpenAiAdapterConfig, OpenAiPricing, ReasoningEffort } from "./adapters/openai";
export {
  DEFAULT_PERPLEXITY_ENDPOINT,
  DEFAULT_PERPLEXITY_PRESET,
  PerplexityAdapter,
  PERPLEXITY_PRICING,
  perplexityCostUsd,
} from "./adapters/perplexity";
export type { PerplexityAdapterConfig, PerplexityPricing } from "./adapters/perplexity";
export {
  DEFAULT_GEMINI_ENDPOINT,
  DEFAULT_GEMINI_MODEL,
  GeminiAdapter,
  GEMINI_PRICING,
  geminiCostUsd,
} from "./adapters/gemini";
export type { GeminiAdapterConfig, GeminiPricing } from "./adapters/gemini";
export {
  CLAUDE_PRICING,
  ClaudeAdapter,
  claudeCostUsd,
  DEFAULT_CLAUDE_ENDPOINT,
  DEFAULT_CLAUDE_MODEL,
} from "./adapters/claude";
export type { ClaudeAdapterConfig, ClaudePricing } from "./adapters/claude";
export {
  DEFAULT_GROK_ENDPOINT,
  DEFAULT_GROK_MODEL,
  GROK_PRICING,
  GrokAdapter,
  grokCostUsd,
} from "./adapters/grok";
export type { GrokAdapterConfig, GrokPricing } from "./adapters/grok";
export { registerLiveAdapters } from "./adapters/live";
export { liveAdapterPlatforms } from "./adapters/live";
export {
  getAdapter,
  getAdapters,
  isPlatform,
  parseAdaptersMode,
  registerLiveAdapter,
  type AdaptersMode,
} from "./adapters/registry";
export { RESPONSE_FIXTURES, fixturesForPlatform } from "./fixtures/responses";
export type { ResponseFixture } from "./fixtures/responses";
export * from "./fixtures/sample-report";
export * from "./storage/types";
export * from "./parsing/types";
export { findAlias, matchEntities, mentionsFromText } from "./parsing/matcher";
export { domainOf, mergeMentions, parseResponse } from "./parsing/parse";
export * from "./metrics/visibility";
export * from "./metrics/confidence";
export * from "./metrics/matrix";
export * from "./metrics/prominence";
export * from "./metrics/interval";
export * from "./metrics/comparability";
export * from "./api/keys";
export * from "./analytics/referrers";
export * from "./analytics/import";
export * from "./analytics/provider";
export { ASSISTANTS, isMeasurableAssistant, measurableAssistants } from "./adapters/catalogue";
export type { Assistant } from "./adapters/catalogue";
export {
  surfaceCapabilities,
  SurfaceProviderNotConfiguredError,
  UnconfiguredSerpProvider,
} from "./adapters/surfaces";
export type { SerpProvider, SurfaceCapability, SurfaceRequirement } from "./adapters/surfaces";
export * from "./auth/email";
export * from "./billing/period";
export * from "./billing/cost";
export * from "./billing/entitlements";
export * from "./billing/partner";
export * from "./billing/payments";
export {
  StripePaymentProvider,
  verifyStripeSignature,
  hmacSha256Hex,
  WebhookSignatureError,
  WEBHOOK_TOLERANCE_SECONDS,
} from "./billing/stripe";
export type { StripeEvent, StripePaymentProviderConfig, StripePrices } from "./billing/stripe";
export { CreemPaymentProvider } from "./billing/creem";
export type { CreemPaymentProviderConfig, CreemProducts } from "./billing/creem";
export { createPaymentProvider } from "./billing/provider";
export * from "./import/csv";
export * from "./prompts/generate";
export * from "./prompts/ai-generator";
export * from "./parsing/highlight";
export * from "./sources/domains";
export * from "./sources/classifier";
export * from "./diagnosis/source-graph";
export * from "./copy";
export * from "./diagnosis/recommendations";
export * from "./diagnosis/competitors";
export * from "./opportunities/types";
export * from "./opportunities/score";
export * from "./opportunities/detectors";
export * from "./execution/playbooks";
export * from "./execution/brief";
export * from "./execution/outcome";
export * from "./experiments/baseline";
export * from "./experiments/events";
export * from "./experiments/math";
export * from "./reports/schema";
export * from "./reports/build";
export * from "./reports/plan";
export * from "./reports/proposal";
export * from "./email/types";
export * from "./email/templates";
export { MemoryEmailSender, consoleEmailLog } from "./email/memory";
export { ResendEmailSender } from "./email/resend";
export type { ResendEmailSenderConfig } from "./email/resend";
export { createEmailSender, parseEmailMode } from "./email/registry";
export type { EmailMode } from "./email/registry";
export * from "./observability/logger";
export * from "./observability/errors";
