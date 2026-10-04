import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Пропуск на печать отчёта в PDF.
 *
 * Печать открывает ту же публичную страницу, что видит клиент, но выдавать
 * ради неё клиентскую ссылку нельзя: она жила бы 90 дней, считалась бы
 * «ждёт согласования» и оживляла бы отчёт, ссылку на который агентство
 * только что отозвало. Пропуск подписан секретом сервера, знает только
 * id отчёта и живёт минуты — ровно столько, сколько идёт печать.
 */

const PREFIX = "print.";
const TTL_MS = 5 * 60_000;

function sign(body: string): string {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set; report printing needs it.");
  return createHmac("sha256", secret).update(`report-print:${body}`).digest("base64url");
}

export function createPrintToken(reportId: string, now: number = Date.now()): string {
  const body = `${reportId}.${now + TTL_MS}`;
  return `${PREFIX}${body}.${sign(body)}`;
}

/** id отчёта, если пропуск подлинный и не истёк; иначе null. */
export function readPrintToken(token: string, now: number = Date.now()): string | null {
  if (!token.startsWith(PREFIX)) return null;
  const [reportId, expires, signature, ...rest] = token.slice(PREFIX.length).split(".");
  if (!reportId || !expires || !signature || rest.length > 0) return null;
  if (!(Number(expires) > now)) return null;

  const expected = Buffer.from(sign(`${reportId}.${expires}`));
  const given = Buffer.from(signature);
  return given.length === expected.length && timingSafeEqual(given, expected) ? reportId : null;
}
