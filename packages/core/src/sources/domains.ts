/**
 * Классификация процитированных источников по домену.
 *
 * Тип источника определяет, что вообще можно сделать: свою страницу переписать,
 * в обзорную площадку попасть через outreach, а форум — это работа с сообществом.
 * Без этого разделения рекомендация сводится к «нужно больше контента».
 *
 * Правила покрывают частые домены; всё остальное остаётся null и уходит
 * на классификацию моделью (T31). Молча записывать неизвестное в "other"
 * нельзя — тогда диагностика тихо деградирует и никто этого не заметит.
 */

export type SourceType =
  | "owned"
  | "editorial"
  | "review"
  | "directory"
  | "ugc"
  | "social"
  | "product_feed"
  | "documentation"
  | "inaccessible"
  | "other";

/** Площадки отзывов и сравнений — сюда попадают через профиль и работу с отзывами. */
const REVIEW_DOMAINS = [
  "g2.com",
  "capterra.com",
  "trustradius.com",
  "softwareadvice.com",
  "getapp.com",
  "trustpilot.com",
  "gartner.com",
  "peerspot.com",
  "sourceforge.net",
] as const;

/** Каталоги и списки альтернатив — попадание обычно через заявку. */
const DIRECTORY_DOMAINS = [
  "producthunt.com",
  "alternativeto.net",
  "saashub.com",
  "crozdesk.com",
  "slant.co",
  "stackshare.io",
  "clutch.co",
] as const;

/** Сообщества: сюда нельзя «попасть», здесь можно только участвовать. */
const UGC_DOMAINS = [
  "reddit.com",
  "quora.com",
  "stackoverflow.com",
  "stackexchange.com",
  "news.ycombinator.com",
  "ycombinator.com",
  "discourse.org",
  "medium.com",
  "dev.to",
  "hashnode.com",
] as const;

const SOCIAL_DOMAINS = [
  "twitter.com",
  "x.com",
  "linkedin.com",
  "facebook.com",
  "instagram.com",
  "tiktok.com",
  "youtube.com",
  "threads.net",
  "bsky.app",
] as const;

/** Редакционные площадки — работа через отношения с авторами. */
const EDITORIAL_DOMAINS = [
  "forbes.com",
  "techcrunch.com",
  "businessinsider.com",
  "theverge.com",
  "wired.com",
  "zdnet.com",
  "cnet.com",
  "pcmag.com",
  "venturebeat.com",
  "fastcompany.com",
  "inc.com",
  "entrepreneur.com",
] as const;

/** Поддомены, которые почти всегда означают документацию. */
const DOCUMENTATION_PREFIXES = ["docs", "developer", "developers", "api", "help", "support"] as const;

const DICTIONARY: [readonly string[], SourceType][] = [
  [REVIEW_DOMAINS, "review"],
  [DIRECTORY_DOMAINS, "directory"],
  [UGC_DOMAINS, "ugc"],
  [SOCIAL_DOMAINS, "social"],
  [EDITORIAL_DOMAINS, "editorial"],
];

/** Нормализация: без www, в нижнем регистре, без точки на конце. */
export function normalizeDomain(domain: string): string {
  return domain
    .trim()
    .toLowerCase()
    // Схема, путь, порт и параметры: агентство вставляет домен клиента копипастом
    // из адресной строки, и «https://acme.com/» никогда не совпало бы с «acme.com»
    // из цитаты — свои страницы клиента перестали бы опознаваться как свои.
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, "")
    // split, а не replace(/[/?#].*$/): та регулярка квадратична на строке из одних «#».
    .split(/[/?#]/, 1)[0]!
    .replace(/:\d+$/, "")
    .replace(/^www\./, "")
    .replace(/\.$/, "");
}

/** Домен совпадает с базовым или является его поддоменом. */
export function isSameOrSubdomain(domain: string, base: string): boolean {
  const d = normalizeDomain(domain);
  const b = normalizeDomain(base);
  if (b === "") return false;
  return d === b || d.endsWith(`.${b}`);
}

export interface ClassifyOptions {
  /** Домен клиента: его страницы — owned, и это правило важнее словаря. */
  clientDomain?: string;
}

/**
 * Возвращает тип источника или null, если правило не сработало.
 * null — не «неизвестно навсегда», а «нужен следующий классификатор».
 */
export function classifyDomain(domain: string, options: ClassifyOptions = {}): SourceType | null {
  const normalized = normalizeDomain(domain);
  if (normalized === "") return null;

  // Собственный домен клиента важнее словаря: его форум на reddit-подобном
  // движке всё равно остаётся его площадкой.
  if (options.clientDomain && isSameOrSubdomain(normalized, options.clientDomain)) {
    return "owned";
  }

  for (const [domains, type] of DICTIONARY) {
    if (domains.some((known) => isSameOrSubdomain(normalized, known))) {
      return type;
    }
  }

  const [prefix, ...rest] = normalized.split(".");
  if (
    rest.length >= 2 &&
    prefix !== undefined &&
    (DOCUMENTATION_PREFIXES as readonly string[]).includes(prefix)
  ) {
    return "documentation";
  }

  return null;
}

/** Сколько доменов покрыто словарём — полезно для оценки доли, ушедшей к модели. */
export const KNOWN_DOMAIN_COUNT =
  REVIEW_DOMAINS.length +
  DIRECTORY_DOMAINS.length +
  UGC_DOMAINS.length +
  SOCIAL_DOMAINS.length +
  EDITORIAL_DOMAINS.length;
