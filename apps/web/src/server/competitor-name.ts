/**
 * Имя конкурента из процитированного домена.
 *
 * Первая метка домена — не имя: у вендоров цитируются blog.hubspot.com и
 * support.zendesk.com, и конкурент «Blog» потом считался бы в каждом ответе
 * со словом blog. Служебные поддомены пропускаем, зону (последнюю метку) — тоже.
 */
const GENERIC_LABELS = new Set([
  "www", "m", "blog", "blogs", "support", "help", "helpcenter", "app", "apps", "docs", "doc",
  "developer", "developers", "dev", "api", "status", "community", "forum", "forums", "kb",
  "knowledge", "learn", "academy", "info", "news", "shop", "store", "go", "get", "try", "my",
  "portal", "login", "account", "accounts", "resources", "marketplace", "partners", "careers",
  "jobs", "press", "investors", "ir", "cdn", "static", "media", "assets", "download",
  "downloads", "en", "us", "uk", "de", "fr", "es", "co", "com", "net", "org",
]);

export function competitorNameFromDomain(domain: string): string {
  const labels = domain.toLowerCase().split(".").filter(Boolean);
  // ponytail: без списка публичных суффиксов; «co»/«com» в середине (acme.co.uk) пропускаются списком выше.
  const root =
    labels.slice(0, -1).find((label) => !GENERIC_LABELS.has(label)) ?? labels[0] ?? domain;
  return root.charAt(0).toUpperCase() + root.slice(1);
}
