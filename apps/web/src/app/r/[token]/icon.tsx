import { getAgencyById, getClientById, getReportById, getShareByToken } from "@repo/db";
import { db } from "@/server/db";

/**
 * Иконка вкладки для отчёта клиенту — в бренде агентства.
 *
 * Без этого файла страница наследовала иконку продукта из корня приложения,
 * и во вкладке у клиента агентства стоял наш знак. Инвариант 3 запрещает
 * любой брендинг продукта на этой странице, иконка — не исключение.
 *
 * Квадрат цвета агентства с первой буквой его названия. Собирается как SVG:
 * шрифт рисует браузер, и сборке не нужны ни сеть, ни файлы шрифтов.
 */

export const size = { width: 32, height: 32 };
export const contentType = "image/svg+xml";

/** Нейтральный цвет, когда ссылка недействительна или цвет задан криво. */
const FALLBACK_COLOR = "#64748b";

/** Цвет приходит из настроек агентства — в SVG попадает только чистый hex. */
function safeColor(value: string | null | undefined): string {
  return value && /^#[0-9a-fA-F]{3}([0-9a-fA-F]{3})?$/.test(value) ? value : FALLBACK_COLOR;
}

function initialOf(name: string | null | undefined): string {
  const letter = name?.trim().match(/[\p{L}\p{N}]/u)?.[0];
  return letter ? letter.toUpperCase() : "";
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (ch) => `&#${ch.charCodeAt(0)};`);
}

async function brandFor(token: string): Promise<{ color: string; initial: string }> {
  const share = await getShareByToken(db, token);
  const expired = share?.expiresAt ? share.expiresAt.getTime() < Date.now() : false;
  if (!share || expired) return { color: FALLBACK_COLOR, initial: "" };

  const report = await getReportById(db, share.reportId);
  const client = report ? await getClientById(db, report.clientId) : undefined;
  const agency = client ? await getAgencyById(db, client.agencyId) : undefined;
  return { color: safeColor(agency?.brandColor), initial: initialOf(agency?.name) };
}

export default async function Icon({
  params,
}: {
  params: Promise<{ token: string }> | { token: string };
}) {
  const { token } = await params;
  const { color, initial } = await brandFor(token);

  const letter = initial
    ? `<text x="16" y="22" text-anchor="middle" font-family="system-ui, -apple-system, Segoe UI, sans-serif" font-size="18" font-weight="600" fill="#ffffff">${escapeXml(initial)}</text>`
    : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="${color}"/>${letter}</svg>`;

  return new Response(svg, {
    headers: {
      "content-type": contentType,
      // Цвет агентства может смениться; держать старую иконку сутками незачем.
      "cache-control": "public, max-age=300",
    },
  });
}
