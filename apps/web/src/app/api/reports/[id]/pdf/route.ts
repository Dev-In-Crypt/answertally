import { randomBytes } from "node:crypto";
import { headers } from "next/headers";
import { z } from "zod";
import {
  createReportShare,
  getClientById,
  getReportById,
  getShareForReport,
  setReportPdfKey,
} from "@repo/db";
import { auth } from "@/lib/auth";
import { storeReportPdf } from "@/server/report-pdf";
import { storage } from "@/server/storage";
import { db } from "@/server/db";
import { hit } from "@/server/rate-limit";

/** Сколько новых PDF агентство печатает в час: каждый — запуск браузера. */
const PDF_RENDERS_PER_HOUR = 10;

/** Печать отчёта в PDF. Доступна только агентству-владельцу. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  const agencyId = (session?.user as { agencyId?: string } | undefined)?.agencyId;

  if (!agencyId) {
    return new Response("Unauthorized", { status: 401 });
  }

  // Не-UUID в пути — несуществующий отчёт, а не ошибка базы с кодом 500.
  if (!z.uuid().safeParse(id).success) {
    return new Response("Not found", { status: 404 });
  }

  const report = await getReportById(db, id);
  const client = report ? await getClientById(db, report.clientId) : undefined;

  // Чужой отчёт неотличим от несуществующего (инвариант 1).
  if (!report || !client || client.agencyId !== agencyId) {
    return new Response("Not found", { status: 404 });
  }

  // Отчёт после генерации не меняется — напечатанный однажды PDF отдаётся
  // из хранилища. Раньше каждый запрос поднимал новый Chromium, и два
  // десятка запросов подряд роняли веб по памяти.
  // ponytail: смена логотипа агентства в уже напечатанный PDF не попадёт —
  // сбрасывать ключ при смене бренда, если об этом попросят.
  if (report.pdfStorageKey) {
    const cached = await storage.get(report.pdfStorageKey);
    if (cached) {
      return pdfResponse(report.id, cached.bytes);
    }
  }

  if (!(await hit(`pdf:${agencyId}`, PDF_RENDERS_PER_HOUR, 60 * 60))) {
    return new Response("Too many PDF renders. Try again in an hour.", { status: 429 });
  }

  // PDF печатается с публичной страницы, поэтому ссылка нужна даже если
  // агентство её ещё не выдавало клиенту.
  let share = await getShareForReport(db, report.id);
  if (!share) {
    share = await createReportShare(db, {
      reportId: report.id,
      token: randomBytes(32).toString("base64url"),
    });
  }

  // Страницу открывает браузер на этой же машине, поэтому сначала —
  // внутренний адрес: публичный изнутри контейнера может быть недоступен
  // (порт снаружи другой, а за прокси — ещё и лишний круг через интернет).
  const origin =
    process.env.INTERNAL_APP_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://127.0.0.1:3000";
  const key = await storeReportPdf(report.id, `${origin}/r/${share.token}`);
  await setReportPdfKey(db, report.id, key);

  const stored = await storage.get(key);
  if (!stored) {
    return new Response("Failed to render", { status: 500 });
  }

  return pdfResponse(report.id, stored.bytes);
}

function pdfResponse(reportId: string, bytes: Uint8Array): Response {
  return new Response(bytes as BodyInit, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="report-${reportId}.pdf"`,
    },
  });
}
