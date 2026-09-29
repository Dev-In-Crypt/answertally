import type { Metadata } from "next";
import { SAMPLE_AUDIT_REPORT } from "@repo/core";
import { SampleFrame } from "../sample-frame";

/**
 * Пример отчёта бесплатного аудита — то, чем заканчивается главный призыв
 * лендинга. Работ в нём не сделано и результатов нет: это снимок «как сейчас»
 * плюс предложение, и подкрашивать его выдуманной работой нельзя.
 */
export const metadata: Metadata = {
  title: "Example audit report — Answertally",
  description:
    "A sample of the free audit: where the client stands in AI answers today, the ranked work behind the gap and the scope proposed for it.",
};

export default function SampleAuditReportPage() {
  return <SampleFrame payload={SAMPLE_AUDIT_REPORT} variant="audit" />;
}
