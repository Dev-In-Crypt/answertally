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
  title: "Example client report — Answertally",
  description:
    "A sample of the report an agency hands its client: visibility over the period, the work behind it and what the numbers do not mean.",
};

export default function SampleReportPage() {
  return <SampleFrame payload={SAMPLE_DELIVERY_REPORT} variant="delivery" />;
}
