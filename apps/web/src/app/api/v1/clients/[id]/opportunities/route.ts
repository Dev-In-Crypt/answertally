import { OPPORTUNITY_COPY } from "@repo/core";
import { getClientById } from "@repo/db";
import { apiError, authenticateApiRequest, notFound } from "@/server/api-auth";
import { clientOpportunities } from "@/server/opportunities";
import { db } from "@/server/db";

/**
 * Возможности клиента: где он проигрывает, насколько это измерено и что
 * предлагается сделать.
 *
 * Отдаётся то же, что видит агентство на экране — из тех же строк. Оговорка
 * о природе оценки едет вместе с данными: без неё внутреннее число для
 * сортировки работ прочитают как оценку сайта.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
): Promise<Response> {
  const { id } = await params;

  const auth = await authenticateApiRequest(db, request);
  if (!auth.ok) {
    return apiError(auth.status, auth.message);
  }

  const client = await getClientById(db, id);
  if (!client || client.agencyId !== auth.caller.agencyId) {
    return notFound();
  }

  return Response.json({
    data: await clientOpportunities(db, id),
    meta: { basis: OPPORTUNITY_COPY.basis, scoreBasis: OPPORTUNITY_COPY.scoreBasis },
  });
}
