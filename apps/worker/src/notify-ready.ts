import { createEmailSender, measurementReadyEmail, type EmailSender } from "@repo/core";
import { getClientById, getRunById, listUsersByAgency, type Database } from "@repo/db";

/**
 * Письмо «замер готов» после прогона, запущенного человеком.
 *
 * Аудит идёт минуты, и без письма человек не знал, когда вернуться. По
 * расписанию не пишем: это фоновая работа, о ней сообщает сам экран. Только
 * владельцу и админам: участники аудит не запускают и в письмах не нуждаются.
 */
let sender: EmailSender | null = null;

export async function notifyMeasurementReady(
  db: Database,
  runId: string,
  send: EmailSender = (sender ??= createEmailSender()),
): Promise<number> {
  const run = await getRunById(db, runId);
  if (!run || run.trigger !== "manual" || run.adaptersMode !== "live" || run.status !== "done") {
    return 0;
  }
  const client = await getClientById(db, run.clientId);
  if (!client) return 0;

  const base = (process.env["NEXT_PUBLIC_APP_URL"] ?? "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//i.test(base)) return 0;
  // Без расписания это аудит: у него свой экран с ранжированной работой.
  const resultsUrl = `${base}/clients/${client.id}${run.scheduleId ? "" : "/audit"}`;

  const recipients = (await listUsersByAgency(db, client.agencyId)).filter(
    (user) => user.role === "owner" || user.role === "admin",
  );
  for (const user of recipients) {
    await send.send(measurementReadyEmail({ to: user.email, clientName: client.name, resultsUrl }));
  }
  return recipients.length;
}
