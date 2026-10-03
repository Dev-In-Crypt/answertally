/**
 * Один ящик — один бесплатный аудит.
 *
 * Бесплатный аудит привязан к аккаунту, а аккаунт — к строке адреса. Gmail
 * доставляет `a.b@gmail.com`, `ab+1@gmail.com` и `ab@googlemail.com` в один
 * ящик, и каждый такой вариант давал новый аудит за наш счёт. Канонический
 * адрес схлопывает их в один.
 *
 * Правила (то же выражение повторено в SQL — `canonicalEmailSql` в @repo/db,
 * тест сверяет их):
 * - нижний регистр;
 * - `+метка` отбрасывается у всех: её понимают почти все крупные почты;
 * - точки в имени отбрасываются только у Gmail — у остальных точка значима;
 * - googlemail.com — это gmail.com.
 */
export function canonicalEmail(email: string): string {
  const lower = email.trim().toLowerCase();
  const at = lower.lastIndexOf("@");
  if (at < 0) return lower;

  let local = lower.slice(0, at).split("+")[0] ?? "";
  let domain = lower.slice(at + 1);
  if (domain === "gmail.com" || domain === "googlemail.com") {
    domain = "gmail.com";
    local = local.replaceAll(".", "");
  }
  return `${local}@${domain}`;
}

/**
 * Самые ходовые одноразовые почты.
 *
 * ponytail: список неполный намеренно — без новой зависимости и без похода в
 * сеть. Он закрывает «первые десять ссылок в поиске», а не решительного
 * злоумышленника; расширять по тем доменам, что реально появятся в базе.
 */
const DISPOSABLE_DOMAINS: ReadonlySet<string> = new Set([
  "10minutemail.com",
  "10minutemail.net",
  "20minutemail.com",
  "33mail.com",
  "anonaddy.me",
  "burnermail.io",
  "byom.de",
  "dispostable.com",
  "dropmail.me",
  "emailondeck.com",
  "fakeinbox.com",
  "fakemail.net",
  "getairmail.com",
  "getnada.com",
  "guerrillamail.biz",
  "guerrillamail.com",
  "guerrillamail.de",
  "guerrillamail.info",
  "guerrillamail.net",
  "guerrillamail.org",
  "guerrillamailblock.com",
  "harakirimail.com",
  "inboxbear.com",
  "inboxkitten.com",
  "incognitomail.org",
  "jetable.org",
  "kurzepost.de",
  "linshiyouxiang.net",
  "mail-temp.com",
  "mail.tm",
  "mailcatch.com",
  "maildrop.cc",
  "mailinator.com",
  "mailinator.net",
  "mailnesia.com",
  "mailpoof.com",
  "mailsac.com",
  "mohmal.com",
  "mintemail.com",
  "moakt.com",
  "mytemp.email",
  "nada.email",
  "sharklasers.com",
  "spam4.me",
  "spambox.us",
  "spamgourmet.com",
  "temp-mail.io",
  "temp-mail.org",
  "tempail.com",
  "tempmail.com",
  "tempmail.dev",
  "tempmail.net",
  "tempmailo.com",
  "tempr.email",
  "throwawaymail.com",
  "tmail.ws",
  "tmpmail.net",
  "tmpmail.org",
  "trashmail.com",
  "trashmail.de",
  "trashmail.net",
  "yopmail.com",
  "yopmail.fr",
  "yopmail.net",
]);

export function isDisposableEmail(email: string): boolean {
  const domain = email.trim().toLowerCase().split("@").pop() ?? "";
  return DISPOSABLE_DOMAINS.has(domain);
}
