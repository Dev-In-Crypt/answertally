"use client";

import { useState } from "react";
import { ASSISTANTS, decodeCsvBytes, MEASUREMENT_COPY, platformLabel } from "@repo/core";
import { api } from "@/trpc/react";
import { FileInput } from "@/components/ui/file-input";

/**
 * Переходы от ассистентов.
 *
 * Стоит рядом с видимостью и никогда не смешивается с ней: это другое
 * наблюдение, из другого источника, с другим пределом. Переходы
 * недосчитываются — встроенные браузеры не передают источник, а часть людей
 * набирает название бренда руками, — и об этом сказано прямо на экране.
 */

const LABELS = new Map(ASSISTANTS.map((assistant) => [assistant.id, assistant.label]));

export function TrafficCard({
  clientId,
  visibilityDeltaPp = null,
}: {
  clientId: string;
  /** Движение видимости за то же окно — только чтобы поставить рядом. */
  visibilityDeltaPp?: number | null;
}) {
  const utils = api.useUtils();
  const [result, setResult] = useState<{ imported: number; skipped: string[] } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);

  const summary = api.analytics.summary.useQuery({ clientId });

  const importTraffic = api.analytics.importTraffic.useMutation({
    onSuccess: async (data) => {
      setResult({ imported: data.imported, skipped: data.skippedReferrers });
      setErrors(data.errors);
      await utils.analytics.summary.invalidate({ clientId });
    },
    onError: (error) => setErrors([error.message]),
  });

  async function handleFile(file: File | null) {
    if (!file) return;

    setErrors([]);
    setResult(null);
    // Байты, а не file.text(): ANSI-выгрузка Excel иначе портит буквы.
    const csv = decodeCsvBytes(new Uint8Array(await file.arrayBuffer()));
    // Те же границы, что у сервера, но словами, а не отказом валидации.
    if (csv.trim() === "") {
      setErrors(["The file is empty."]);
    } else if (csv.length > 2_000_000) {
      setErrors([
        "The file is over 2 MB. Export a shorter date range and import the parts one by one.",
      ]);
    } else {
      importTraffic.mutate({ clientId, csv });
    }
  }

  const data = summary.data;

  return (
    <div className="flex flex-col gap-3 rounded-lg border p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-medium">Traffic from assistants</h2>
        {data && (
          <span className="metric text-xs text-muted-foreground">last {data.windowDays} days</span>
        )}
      </div>

      {data && data.totalSessions > 0 ? (
        <>
          <div className="flex items-baseline gap-2">
            <span data-testid="traffic-total" className="metric text-2xl font-semibold">
              {data.totalSessions.toLocaleString("en-US")}
            </span>
            <span className="text-sm text-muted-foreground">sessions referred</span>
          </div>

          {/* Видимость и переходы — рядом, но без связи между ними: «выросло
              вместе» и «одно вызвало другое» проверяются по-разному, и второе
              на этих данных не проверяется никак. */}
          {visibilityDeltaPp !== null && (
            <div data-testid="outcomes-side-by-side" className="flex flex-col gap-1 border-t pt-2">
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-muted-foreground">Visibility, same period</span>
                <span className="metric">
                  {visibilityDeltaPp >= 0 ? "+" : ""}
                  {visibilityDeltaPp} pp
                </span>
              </div>
              <p className="text-xs text-muted-foreground">{MEASUREMENT_COPY.observedTogether}</p>
            </div>
          )}

          <ul data-testid="traffic-list" className="flex flex-col gap-1 text-sm">
            {data.byAssistant.map((entry) => (
              <li key={entry.assistant} className="flex justify-between gap-3">
                {/* Каталог знает только измеряемых, а переход может прийти
                    и от того, кого мы не измеряем, — имя берётся шире. */}
                <span>{LABELS.get(entry.assistant) ?? platformLabel(entry.assistant)}</span>
                <span className="metric text-muted-foreground">
                  {entry.sessions.toLocaleString("en-US")} · {entry.sharePct}%
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <p data-testid="traffic-empty" className="text-sm text-muted-foreground">
          No referred sessions imported yet. Export the referral report from the client&apos;s
          analytics and drop it here — columns: date, source, sessions. A GA4 CSV download works as
          is, once Date is added as a dimension.
        </p>
      )}

      {/* Предел метрики стоит рядом с цифрой, а не в сноске под экраном. */}
      <p className="text-xs text-muted-foreground">{MEASUREMENT_COPY.trafficUndercount}</p>

      <FileInput
        label="Import a referral export"
        accept=".csv,text/csv"
        onSelect={(file) => void handleFile(file)}
        testId="traffic-csv"
      />

      {result && (
        <p data-testid="traffic-import" className="text-xs text-muted-foreground">
          Imported {result.imported} rows.
          {result.skipped.length > 0 &&
            ` Skipped sources that are not assistants: ${result.skipped.slice(0, 5).join(", ")}.`}
        </p>
      )}

      {errors.length > 0 && (
        <ul data-testid="traffic-errors" className="flex flex-col gap-1 text-xs text-destructive">
          {errors.slice(0, 5).map((message) => (
            <li key={message}>{message}</li>
          ))}
        </ul>
      )}
    </div>
  );
}
