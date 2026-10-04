import { TRPCError } from "@trpc/server";
import { listInvitationsByAgency, type Database } from "@repo/db";
import { hit, unhit } from "./rate-limit";
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

/**
 * Списывается до отправки, а неушедшее письмо возвращают (`refundDailyQuota`).
 * Отказы сверх лимита тоже считаются, поэтому текст говорит про лимит, а не
 * «отправили 50». Подсказка своя у каждого вызова: у
 * приглашения, в отличие от отчёта, ссылки на этот момент ещё нет.
 */
async function spendDailyQuota(agencyId: string, hint: string): Promise<QuotaSpend> {
  const spend = { key: `agency-email:${agencyId}`, at: Date.now() };
  if (!(await hit(spend.key, PAID_EMAILS_PER_DAY, DAY_SECONDS, spend.at))) {
    throw new TRPCError({
      code: "TOO_MANY_REQUESTS",
      message: `Your workspace has reached today's limit of ${PAID_EMAILS_PER_DAY} emails. ${hint}`,
    });
  }
  return spend;
}

/** Что именно списано: возврат должен попасть в тот же счётчик и то же окно. */
export interface QuotaSpend {
  key: string;
  at: number;
}

/**
 * Вернуть списанное, если письмо не ушло: отказ транспорта или режим без
 * почты. Иначе сбой Resend съедал бы суточную квоту, и агентство упиралось
 * бы в лимит, не отправив ни одного письма.
 */
export async function refundDailyQuota(spend: QuotaSpend): Promise<void> {
  await unhit(spend.key, DAY_SECONDS, spend.at);
}

/** Отчёт письмом — только платящему и в пределах суточной квоты. */
export async function assertMaySendReport(db: Database, agencyId: string): Promise<QuotaSpend> {
  const entitlements = await entitlementsForAgency(db, agencyId);
  if (!entitlements.paying) {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Sending reports by email starts with a plan. Copy the client link and send it yourself.",
    });
  }
  return spendDailyQuota(agencyId, "Copy the client link and send it yourself, or try again tomorrow.");
}

/**
 * Приглашение: до оплаты — не больше трёх в ожидании, после — суточная квота.
 *
 * `refreshing` — повтор на адрес, который уже ждёт: новое место в ожидании
 * он не занимает, и потолок трёх его не касается. Суточный счёт — касается:
 * письмо уходит и при повторе.
 */
export async function assertMayInvite(
  db: Database,
  agencyId: string,
  { refreshing = false }: { refreshing?: boolean } = {},
): Promise<QuotaSpend> {
  const entitlements = await entitlementsForAgency(db, agencyId);
  if (!entitlements.paying) {
    const pending = refreshing ? [] : await listInvitationsByAgency(db, agencyId);
    const live = pending.filter((invite) => invite.expiresAt.getTime() > Date.now());
    if (live.length >= FREE_PENDING_INVITES) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Up to ${FREE_PENDING_INVITES} invitations can wait at once before a plan. Revoke one you no longer need, or wait for one to be accepted.`,
      });
    }
    // Отзыв освобождает место в ожидании, и «пригласить — отозвать —
    // пригласить» слало бы письма без конца. Суточный счёт закрывает это.
    const spend = { key: `agency-invite:${agencyId}`, at: Date.now() };
    if (!(await hit(spend.key, FREE_INVITES_PER_DAY, DAY_SECONDS, spend.at))) {
      throw new TRPCError({
        code: "TOO_MANY_REQUESTS",
        message: `Up to ${FREE_INVITES_PER_DAY} invitations a day before a plan. Try again tomorrow.`,
      });
    }
    return spend;
  }
  return spendDailyQuota(agencyId, "Try again tomorrow.");
}
