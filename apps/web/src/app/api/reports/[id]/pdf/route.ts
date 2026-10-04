import { headers } from "next/headers";
import { z } from "zod";
import { getClientById, getReportApproval, getReportById, setReportPdfKey } from "@repo/db";
import { auth } from "@/lib/auth";
import { createPrintToken } from "@/app/r/print-token";
import { isPdfRendering, reportPdfKey, storeReportPdf } from "@/server/report-pdf";
import { storage } from "@/server/storage";
import { db } from "@/server/db";
import { hit } from "@/server/rate-limit";

/** Сколько новых PDF агентство печатает в час: каждый — запуск браузера. */
const PDF_RENDERS_PER_HOUR = 10;

/**
 * Ответ с ошибкой — одной человеческой фразой: экран отчётов показывает
 * текст ответа как есть, рядом с кнопкой.
 */
function failure(message: string, status: number): Response {
  return new Response(message, { status, headers: { "Content-Type": "text/plain; charset=utf-8" } });
}

/** Печать отчёта в PDF. Доступна только агентству-владельцу. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  const agencyId = (session?.user as { agencyId?: string } | undefined)?.agencyId;

  if (!agencyId) {
    return failure("Your session has ended. Sign in again to download the PDF.", 401);
  }

  // Не-UUID в пути — несуществующий отчёт, а не ошибка базы с кодом 500.
  if (!z.uuid().safeParse(id).success) {
    return failure("This report was not found.", 404);
  }

  const report = await getReportById(db, id);
  const client = report ? await getClientById(db, report.clientId) : undefined;

  // Чужой отчёт неотличим от несуществующего (инвариант 1).
  if (!report || !client || client.agencyId !== agencyId) {
    return failure("This report was not found.", 404);
  }

  // Отчёт после генерации не меняется — напечатанный однажды PDF отдаётся
  // из хранилища. Раньше каждый запрос поднимал новый Chromium, и два
  // десятка запросов подряд роняли веб по памяти. Подтверждение клиента
  // меняет ключ, поэтому PDF до согласования после него не отдаётся.
  // ponytail: смена логотипа агентства в уже напечатанный PDF не попадёт —
  // сбрасывать ключ при смене бренда, если об этом попросят.
  const key = reportPdfKey(report.id, (await getReportApproval(db, report.id)) !== null);
  if (report.pdfStorageKey === key) {
    const cached = await storage.get(key);
    if (cached) {
      return pdfResponse(report.id, cached.bytes);
    }
  }

  // Повторный клик во время печати ждёт её, а не считается новой печатью.
  if (!isPdfRendering(key) && !(await hit(`pdf:${agencyId}`, PDF_RENDERS_PER_HOUR, 60 * 60))) {
    return failure(
      `You've reached ${PDF_RENDERS_PER_HOUR} new PDFs this hour. Try again later — PDFs you've already downloaded open right away.`,
      429,
    );
  }

  // Страницу открывает браузер на этой же машине, поэтому сначала —
  // внутренний адрес: публичный изнутри контейнера может быть недоступен
  // (порт снаружи другой, а за прокси — ещё и лишний круг через интернет).
  // Печать идёт по своему короткому пропуску: клиентская ссылка ради неё
  // не выдаётся (иначе отчёт «ждал бы согласования», которого никто не просил).
  const origin =
    process.env.INTERNAL_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://127.0.0.1:3000";

  try {
    await storeReportPdf(key, `${origin}/r/${createPrintToken(report.id)}`);
    await setReportPdfKey(db, report.id, key);
    const stored = await storage.get(key);
    if (stored) return pdfResponse(report.id, stored.bytes);
  } catch (error) {
    console.error(`[pdf] render failed for report ${report.id}`, error);
  }

  return failure("The PDF couldn't be generated right now. Try again in a few minutes.", 500);
}

function pdfResponse(reportId: string, bytes: Uint8Array): Response {
  return new Response(bytes as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="report-${reportId}.pdf"`,
    },
  });
}
