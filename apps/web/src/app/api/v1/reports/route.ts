import { listClientsByAgency, listReports } from "@repo/db";
import { apiError, authenticateApiRequest } from "@/server/api-auth";
import { db } from "@/server/db";

/**
 * Отчёты агентства. Отдаётся список, а не содержимое: payload отчёта — это
 * документ клиента, и вытаскивать его в чужой дашборд целиком незачем.
 */
export async function GET(request: Request): Promise<Response> {
  const auth = await authenticateApiRequest(db, request);
  if (!auth.ok) {
    return apiError(auth.status, auth.message);
  }

  const clients = await listClientsByAgency(db, auth.caller.agencyId);
  const byClient = await Promise.all(
    clients.map(async (client) => ({ client, reports: await listReports(db, client.id) })),
  );

  const data = byClient.flatMap(({ client, reports }) =>
    reports.map((report) => ({
      id: report.id,
      clientId: client.id,
      clientName: client.name,
      periodStart: report.periodStart,
      periodEnd: report.periodEnd,
      status: report.status,
      createdAt: report.createdAt,
    })),
  );

  data.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return Response.json({ data });
}
