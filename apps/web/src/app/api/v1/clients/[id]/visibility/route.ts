import { getClientById } from "@repo/db";
import { apiError, authenticateApiRequest, notFound } from "@/server/api-auth";
import { clientVisibility } from "@/server/visibility";
import { db } from "@/server/db";

/**
 * Видимость клиента за окно — та же функция, что питает экран.
 *
 * В ответе есть интервалы и признак различимости движения: цифра без них
 * в чужом дашборде превратится в «мы выросли на 3 пункта», чего эта
 * выборка не утверждает.
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
  // Чужой клиент неотличим от несуществующего (инвариант 1).
  if (!client || client.agencyId !== auth.caller.agencyId) {
    return notFound();
  }

  const raw = new URL(request.url).searchParams.get("windowDays");
  const parsed = raw === null ? 28 : Number(raw);
  if (!Number.isInteger(parsed) || parsed < 7 || parsed > 90) {
    return apiError(400, "windowDays must be a whole number between 7 and 90.");
  }

  return Response.json({ data: await clientVisibility(db, client, parsed) });
}
