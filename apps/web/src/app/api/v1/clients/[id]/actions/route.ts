import { getClientById, listActions } from "@repo/db";
import { apiError, authenticateApiRequest, notFound } from "@/server/api-auth";
import { db } from "@/server/db";

/** Очередь работ клиента. Каждая строка несёт причину, по которой она существует. */
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

  const actions = await listActions(db, id);

  return Response.json({
    data: actions.map((action) => ({
      id: action.id,
      title: action.title,
      // Инвариант 7: причина едет вместе с действием и наружу тоже.
      reason: action.reason,
      actionType: action.actionType,
      status: action.status,
      estimatedImpact: action.estimatedImpact,
      effort: action.effort,
      sourceDomain: action.sourceDomain,
      evidence: action.evidence,
      createdAt: action.createdAt,
      completedAt: action.completedAt,
    })),
  });
}
