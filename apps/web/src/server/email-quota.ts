import { TRPCError } from "@trpc/server";
import { listInvitationsByAgency, type Database } from "@repo/db";
import { hit } from "./rate-limit";
import { entitlementsForAgency } from "./subscription";

/**
 * Письма, которые агентство шлёт через наш домен на чужие адреса.
 *
 * Отчёт и приглашение уходят на любой адрес, подписаны названием агентства,
 * а его задаёт сам пользователь. Без границ это готовая рассылка фишинга от
 * нашего проверенного домена: «PayPal Security» с припиской-ссылкой. Ценой
 * был бы весь домен — заблокированный отправитель перестаёт доставлять и
 * письма подтверждения, и регистрация встаёт у всех.
 *
 * Границы — решение фаундера: до оплаты отчёт отправляется только ссылкой,
 * приглашений в ожидании не больше трёх; после — 50 писем в сутки.
 */
export const PAID_EMAILS_PER_DAY = 50;
export const FREE_PENDING_INVITES = 3;
export const FREE_INVITES_PER_DAY = 5;

const DAY_SECONDS = 24 * 60 * 60;

async function spendDailyQuota(agencyId: string): Promise<void> {
  if (!(await hit(`agency-email:${agencyId}`, PAID_EMAILS_PER_DAY, DAY_SECONDS))) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `Your workspace has sent ${PAID_EMAILS_PER_DAY} emails today. Copy the link and send it yourself, or try tomorrow.`,
    });
  }
}

/** Отчёт письмом — только платящему и в пределах суточной квоты. */
export async function assertMaySendReport(db: Database, agencyId: string): Promise<void> {
  const entitlements = await entitlementsForAgency(db, agencyId);
  if (!entitlements.paying) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Sending reports by email starts with a plan. Copy the client link and send it yourself.",
    });
  }
  await spendDailyQuota(agencyId);
}

/** Приглашение: до оплаты — не больше трёх в ожидании, после — суточная квота. */
export async function assertMayInvite(db: Database, agencyId: string): Promise<void> {
  const entitlements = await entitlementsForAgency(db, agencyId);
  if (!entitlements.paying) {
    const pending = await listInvitationsByAgency(db, agencyId);
    const live = pending.filter((invite) => invite.expiresAt.getTime() > Date.now());
    if (live.length >= FREE_PENDING_INVITES) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Up to ${FREE_PENDING_INVITES} invitations can wait at once before a plan. Wait for one to be accepted or to expire.`,
      });
    }
    // Отзыв освобождает место в ожидании, и «пригласить — отозвать —
    // пригласить» слало бы письма без конца. Суточный счёт закрывает это.
    if (!(await hit(`agency-invite:${agencyId}`, FREE_INVITES_PER_DAY, DAY_SECONDS))) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `Up to ${FREE_INVITES_PER_DAY} invitations a day before a plan. Try again tomorrow.`,
      });
    }
    return;
  }
  await spendDailyQuota(agencyId);
}
