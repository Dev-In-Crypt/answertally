import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/**
 * Сжатый текст главной страницы клиента — для генерации вопросов.
 *
 * Адрес вводит пользователь, поэтому запрос идёт только на публичный хост:
 * иначе поле «Domain» стало бы способом заглянуть во внутреннюю сеть сервера.
 * Любой сбой — `null`: вопросы тогда пишутся без сайта, а не не пишутся вовсе.
 */

const TIMEOUT_MS = 8_000;
const MAX_BYTES = 400_000;
// Saucony: apex → www → gateway → регион → home, четыре перехода.
const MAX_REDIRECTS = 5;
const MAX_SUMMARY = 3_000;

/** Частные, локальные и служебные диапазоны: туда сервер ходить не должен. */
export function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 6) {
    const a = address.toLowerCase();
    if (a === "::1" || a === "::") return true;
    if (a.startsWith("fc") || a.startsWith("fd") || a.startsWith("fe80")) return true;
    const mapped = a.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    return mapped ? isPrivateAddress(mapped[1]!) : false;
  }
  const [a = 0, b = 0] = address.split(".").map(Number);
  return (
    a === 0 ||
    a === 10 ||
    a === 127 ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224
  );
}

async function assertPublicHost(hostname: string): Promise<void> {
  if (hostname === "localhost" || hostname.endsWith(".local") || hostname.endsWith(".internal")) {
    throw new Error("private host");
  }
  // ponytail: адрес проверяется до запроса, а fetch резолвит его ещё раз —
  // подмена DNS между двумя запросами не закрыта; закрывать своим агентом, если понадобится.
  const addresses = isIP(hostname) ? [{ address: hostname }] : await lookup(hostname, { all: true });
  if (addresses.length === 0 || addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new Error("private host");
  }
}

/** «https://www.saucony.com/», «saucony.com» → https://saucony.com/ */
export function homepageUrl(domain: string): URL | null {
  try {
    const url = new URL(/^https?:\/\//i.test(domain.trim()) ? domain.trim() : `https://${domain.trim()}`);
    return new URL(`https://${url.hostname}/`);
  } catch {
    return null;
  }
}

function decode(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Заголовки интерфейса, а не содержания: корзина, поиск, подвал. */
const UI_HEADING = /^(search|cart|bag|shopping bag|menu|footer|site footer|sign in|log in|account|support|location settings|edit item|close|newsletter|cookies?)\b/i;

/** Описания из JSON-LD: Organization, WebSite, Product. Читаются до вырезания скриптов. */
function jsonLdDescriptions(html: string): string[] {
  const found: string[] = [];
  for (const match of html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const walk = (node: unknown): void => {
        if (Array.isArray(node)) node.forEach(walk);
        else if (node && typeof node === "object") {
          const record = node as Record<string, unknown>;
          if (typeof record["description"] === "string") found.push(decode(record["description"]));
          if (record["@graph"]) walk(record["@graph"]);
        }
      };
      walk(JSON.parse(match[1] ?? ""));
    } catch {
      // Битый JSON-LD у чужого сайта — не наша ошибка; пропускаем.
    }
  }
  return found;
}

/** Заголовок, описание и заголовки разделов — то, что сайт говорит о себе. */
export function summarizeHtml(html: string): string {
  const structured = jsonLdDescriptions(html);
  const body = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ");
  const pick = (re: RegExp) => [...body.matchAll(re)].map((m) => decode((m[1] ?? "").replace(/<[^>]+>/g, " ")));
  // До той же кавычки, что открыла значение: «HubSpot's platform…» не обрывается на апострофе.
  const meta = (name: string) =>
    decode(
      body.match(new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]*content=(["'])([\\s\\S]*?)\\1`, "i"))?.[2] ??
        body.match(new RegExp(`<meta[^>]+content=(["'])([\\s\\S]*?)\\1[^>]*(?:name|property)=["']${name}["']`, "i"))?.[2] ??
        "",
    );
  // Самое длинное из описаний: у Glossier meta description — одно слово, а og — абзац.
  const description = [meta("description"), meta("og:description"), ...structured].sort((a, b) => b.length - a.length)[0] ?? "";
  const headings = [...new Set(pick(/<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/gi))].filter(
    (h) => h.length > 1 && h.length < 120 && !UI_HEADING.test(h),
  );
  const links = [
    ...new Set(
      [...body.matchAll(/<nav[^>]*>([\s\S]*?)<\/nav>/gi)].flatMap((nav) =>
        [...(nav[1] ?? "").matchAll(/<a[^>]*>([\s\S]*?)<\/a>/gi)].map((a) => decode((a[1] ?? "").replace(/<[^>]+>/g, " "))),
      ),
    ),
  ].filter((text) => text.length > 1 && text.length < 40 && !UI_HEADING.test(text));
  const lang = body.match(/<html[^>]+lang=["']([a-z-]+)["']/i)?.[1];

  const lines = [
    `Title: ${pick(/<title[^>]*>([\s\S]*?)<\/title>/gi)[0] ?? ""}`,
    `Description: ${description}`,
    `Headings: ${headings.slice(0, 30).join(" | ")}`,
    `Navigation: ${links.slice(0, 40).join(", ")}`,
    // Сервер в Европе, и сайт может отдать региональную версию на чужом языке.
    lang && !lang.toLowerCase().startsWith("en") ? `Note: this is a regional version of the site (language: ${lang}).` : "",
  ];
  return lines.filter(Boolean).join("\n").slice(0, MAX_SUMMARY);
}

export async function fetchSiteSummary(domain: string, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  let url = homepageUrl(domain);
  if (!url) return null;

  try {
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      await assertPublicHost(url.hostname);
      const response: Response = await fetchImpl(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { "User-Agent": "AnswertallyBot/1.0 (+https://answertally.com)", Accept: "text/html", "Accept-Language": "en-US,en;q=0.9" },
      });
      const location: string | null = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        url = new URL(location, url);
        if (url.protocol !== "https:" && url.protocol !== "http:") return null;
        continue;
      }
      if (!response.ok || !response.body) return null;

      // Читается не больше MAX_BYTES: главная на мегабайты не должна держать запрос.
      const reader = response.body.getReader();
      const chunks: Uint8Array[] = [];
      let size = 0;
      while (size < MAX_BYTES) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        size += value.byteLength;
      }
      await reader.cancel().catch(() => undefined);
      const html = new TextDecoder().decode(Buffer.concat(chunks));
      const summary = summarizeHtml(html);
      return summary.replace(/^(Title|Description|Headings|Navigation): $/gm, "").trim() || null;
    }
    return null;
  } catch {
    return null;
  }
}
