import type { Metadata } from "next";
import { SAMPLE_DELIVERY_REPORT } from "@repo/core";
import { SampleFrame } from "./sample-frame";

/**
 * Живой пример клиентского отчёта.
 *
 * Не скриншот: страница рендерит тот же компонент, что и продукт, поэтому
 * витрина не может отстать от интерфейса. В отличие от `/r/[token]`,
 * индексация здесь нужна — это витрина, а не чужой документ.
 */
export const metadata: Metadata = {
  alternates: { canonical: "/sample-report" },
  title: "AI Visibility Report Example for Clients · Answertally",
  description:
    "How to report AI visibility to a client: a sample white-label report with share of answers, ranges, cited sources and the next sprint the client approves.",
};

export default function SampleReportPage() {
  return <SampleFrame payload={SAMPLE_DELIVERY_REPORT} variant="delivery" />;
}
