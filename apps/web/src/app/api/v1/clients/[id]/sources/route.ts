import { getClientById } from "@repo/db";
import { apiError, authenticateApiRequest, notFound } from "@/server/api-auth";
import { clientSources } from "@/server/sources";
import { db } from "@/server/db";

/** Источники, на которых стоят ответы, и присутствие в них клиента. */
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

  // Оговорка о природе присутствия едет вместе с данными.
  return Response.json({ data: await clientSources(db, id) });
}
