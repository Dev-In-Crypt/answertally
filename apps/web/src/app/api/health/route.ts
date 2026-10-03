import { pingDatabase } from "@repo/db";
import { db } from "@/server/db";

/**
 * Проверка живости для платформы развёртывания.
 *
 * Отвечает 503, пока база недоступна: контейнер, который принимает трафик
 * без базы, отдаёт клиентам агентства пустые отчёты вместо ошибки.
 *
 * Наружу не выдаётся ничего, кроме факта: диагностика — в логах, а этот
 * адрес открыт без ключа.
 */
export const dynamic = "force-dynamic";

export async function GET(): Promise<Response> {
  try {
    await pingDatabase(db);
    return Response.json({ status: "ok" });
  } catch (error) {
    console.error("[health] database is unreachable", error);
    return Response.json({ status: "unavailable" }, { status: 503 });
  }
}
