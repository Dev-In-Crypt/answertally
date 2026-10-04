import type { Metadata } from "next";
import { reportPayloadSchema } from "@repo/core";
import {
  getAgencyById,
  getClientById,
  getReportApproval,
  getReportById,
  getShareByToken,
} from "@repo/db";
import { ReportView } from "@/components/report-view";
import { readPrintToken } from "../print-token";
import { reportUrl } from "../report-url";
import { ApproveForm } from "./approve-form";
import { db } from "@/server/db";

/**
 * Публичный отчёт по ссылке — единственный анонимный доступ в продукте
 * (инвариант 1). Только чтение плюс подтверждение; аккаунт клиенту не нужен,
 * потому что требовать регистрацию от клиента агентства значит убить канал.
 */

/**
 * Метаданные собираются на запрос, а не объявляются константой: canonical
 * зависит от токена и от домена агентства.
 *
 * Каждое поле задано явно, даже там, где корневой layout сегодня ничего не
 * перебивает. Наследование — это способ, которым имя продукта попадает на
 * страницу клиента незаметно: достаточно, чтобы кто-то добавил в корень
 * openGraph с siteName, и он окажется в исходнике отчёта, не сломав ни
 * одного теста про видимый текст.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  // Свой домен агентства, если он настроен; иначе адрес продукта.
  const canonical = reportUrl(token);

  // Заголовок вкладки тоже без брендинга продукта (инвариант 3).
  const title = "AI Search report";
  const description = "Client report on visibility in AI answers.";

  return {
    title,
    description,
    /**
     * Ссылка отдана конкретному человеку — в поиске её быть не должно.
     * Попутно это снимает вопрос, чей домен «главный» для этой страницы.
     */
    robots: { index: false, follow: false },
    alternates: { canonical },
    /**
     * Превью в мессенджере — первое, что видит клиент агентства, ещё не
     * открыв ссылку. Здесь нет ни siteName, ни картинки: и то и другое
     * пришло бы от продукта.
     */
    openGraph: { title, description, url: canonical, type: "website" },
    twitter: { card: "summary", title, description },
  };
}

export default async function PublicReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  // Печать PDF приходит со своим пропуском, а не с клиентской ссылкой.
  const printReportId = readPrintToken(token);
  const share = printReportId ? undefined : await getShareByToken(db, token);
  const expired = share?.expiresAt ? share.expiresAt.getTime() < Date.now() : false;

  if (!printReportId && (!share || expired)) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-3 px-6">
        <h1 className="text-xl font-semibold tracking-tight">This link is no longer valid</h1>
        <p className="text-sm text-muted-foreground">It may have expired. Ask for a fresh link.</p>
      </main>
    );
  }

  const reportId = printReportId ?? share?.reportId;
  const report = reportId ? await getReportById(db, reportId) : undefined;
  const client = report ? await getClientById(db, report.clientId) : undefined;
  const agency = client ? await getAgencyById(db, client.agencyId) : undefined;

  if (!report || !client || !agency) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-md flex-col justify-center gap-3 px-6">
        <h1 className="text-xl font-semibold tracking-tight">This report is unavailable</h1>
      </main>
    );
  }

  const payload = reportPayloadSchema.parse(report.payload);
  // Подтверждение принадлежит отчёту: печать показывает его и без ссылки.
  const approved = share
    ? share.approvedAt
      ? { at: share.approvedAt, byName: share.approvedByName }
      : null
    : await getReportApproval(db, report.id);

  return (
    // Цвет агентства задан на всей странице, а не только внутри отчёта:
    // кнопка approve живёт снаружи и тоже должна быть в его бренде.
    <main style={{ ["--primary" as string]: agency.brandColor }}>
      <ReportView
        payload={payload}
        agency={{
          name: agency.name,
          logoUrl: agency.logoUrl,
          brandColor: agency.brandColor,
        }}
        approved={approved}
      />
      {share && !approved && <ApproveForm token={token} />}
    </main>
  );
}
