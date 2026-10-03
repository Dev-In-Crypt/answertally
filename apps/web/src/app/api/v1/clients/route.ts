import { listClientsByAgency } from "@repo/db";
import { apiError, authenticateApiRequest } from "@/server/api-auth";
import { db } from "@/server/db";

/**
 * Публичный API, версия 1: только чтение.
 *
 * Агентство тянет свои цифры в собственный дашборд. Ничего, что тратит
 * деньги или пишет во внешние системы, здесь нет и в v1 не появится.
 */
export async function GET(request: Request): Promise<Response> {
  const auth = await authenticateApiRequest(db, request);
  if (!auth.ok) {
    return apiError(auth.status, auth.message);
  }

  const clients = await listClientsByAgency(db, auth.caller.agencyId);

  return Response.json({
    data: clients.map((client) => ({
      id: client.id,
      name: client.name,
      domain: client.domain,
      status: client.status,
      industry: client.industry,
      brandNames: client.brandNames,
      competitorNames: client.competitorNames,
      createdAt: client.createdAt,
    })),
  });
}
