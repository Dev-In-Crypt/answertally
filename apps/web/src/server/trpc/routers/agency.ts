import { randomBytes } from "node:crypto";
import { z } from "zod";
import { assertMayInvite } from "../../email-quota";
import { TRPCError } from "@trpc/server";
import {
  createInvitation,
  deactivateUser,
  findUserByCanonicalEmail,
  getUserById,
  refreshInvitation,
  revokeInvitation,
  setUserRole,
  getAgencyById,
  getInvitationByToken,
  listInvitationsByAgency,
  listUsersByAgency,
  updateAgency,
} from "@repo/db";
import { canonicalEmail, inviteEmail } from "@repo/core";
import { protectedProcedure, roleProcedure, router, publicProcedure } from "../trpc";
import { appUrl, getEmailSender } from "../../email";
import { hit } from "../../rate-limit";

const INVITE_TTL_DAYS = 7;

/**
 * Проверок адреса на приглашение в сутки на агентство. Отказ говорит, что у
 * ящика уже есть аккаунт, и без счёта приглашение стало бы бесплатным
 * перебором чужих адресов — то, что регистрация как раз скрывает. Не меньше
 * суточной квоты писем платного агентства, чтобы не упираться раньше неё.
 */
const INVITE_LOOKUPS_PER_DAY = 50;

/** Участник ушёл раньше, чем до него дошёл запрос, — второй администратор успел первым. */
const MEMBER_GONE = "This person is no longer in the workspace. The list is refreshed.";

export const agencyRouter = router({
  get: protectedProcedure.query(async ({ ctx }) => {
    const agency = await getAgencyById(ctx.db, ctx.user.agencyId);
    if (!agency) {
      throw new TRPCError({ code: "NOT_FOUND" });
    }
    return agency;
  }),

  update: roleProcedure("admin")
    .input(
      z.object({
        name: z.string().min(1).max(200).optional(),
        // Логотипа здесь нет: его ставит только загрузка файла. Произвольная
        // ссылка уходила в отчёт клиенту и в браузер печати PDF на сервере.
        brandColor: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #4f46e5")
          .optional(),
      }),
    )
    .mutation(({ ctx, input }) => updateAgency(ctx.db, ctx.user.agencyId, input)),

  members: protectedProcedure.query(async ({ ctx }) => {
    const members = await listUsersByAgency(ctx.db, ctx.user.agencyId);
    return members.map((m) => ({
      id: m.id,
      email: m.email,
      name: m.name,
      role: m.role,
      isYou: m.id === ctx.user.id,
    }));
  }),

  // Без токенов: по токену входят в агентство, и видеть его рядовому
  // участнику незачем — ссылку показывают тому, кто приглашал, один раз.
  invites: protectedProcedure.query(async ({ ctx }) =>
    (await listInvitationsByAgency(ctx.db, ctx.user.agencyId))
      .filter((invite) => invite.expiresAt.getTime() > Date.now())
      .map((invite) => ({
        id: invite.id,
        email: invite.email,
        role: invite.role,
        expiresAt: invite.expiresAt,
      })),
  ),

  /**
   * Убрать участника: войти он больше не может, его входы отозваны. Строка
   * остаётся — по ней живут авторство действий и журнал.
   *
   * Себя и владельца убрать нельзя; администратора убирает только владелец.
   */
  removeMember: roleProcedure("admin")
    .input(z.object({ userId: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      const target = await getUserById(ctx.db, input.userId);
      if (!target || target.agencyId !== ctx.user.agencyId || target.deactivatedAt) {
        throw new TRPCError({ code: "NOT_FOUND", message: MEMBER_GONE });
      }
      if (target.id === ctx.user.id || target.role === "owner") {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "The owner and you yourself stay in the workspace.",
        });
      }
      if (target.role === "admin" && ctx.user.role !== "owner") {
        throw new TRPCError({ code: "FORBIDDEN", message: "Only the owner can remove an admin." });
      }
      await deactivateUser(ctx.db, target.id, ctx.user.agencyId);
      return { id: target.id };
    }),

  /** Сменить роль участника — только владелец и не себе. */
  changeRole: roleProcedure("owner")
    .input(z.object({ userId: z.uuid(), role: z.enum(["admin", "member"]) }))
    .mutation(async ({ ctx, input }) => {
      const target = await getUserById(ctx.db, input.userId);
      if (!target || target.agencyId !== ctx.user.agencyId || target.deactivatedAt) {
        throw new TRPCError({ code: "NOT_FOUND", message: MEMBER_GONE });
      }
      if (target.id === ctx.user.id || target.role === "owner") {
        throw new TRPCError({ code: "FORBIDDEN", message: "The owner's role does not change." });
      }
      await setUserRole(ctx.db, target.id, ctx.user.agencyId, input.role);
      return { id: target.id, role: input.role };
    }),

  revokeInvite: roleProcedure("admin")
    .input(z.object({ id: z.uuid() }))
    .mutation(async ({ ctx, input }) => {
      await revokeInvitation(ctx.db, input.id, ctx.user.agencyId);
      return { id: input.id };
    }),

  invite: roleProcedure("admin")
    .input(z.object({ email: z.email(), role: z.enum(["admin", "member"]).default("member") }))
    .mutation(async ({ ctx, input }) => {
      // Better Auth хранит почту пользователя в нижнем регистре.
      const email = input.email.toLowerCase();

      /**
       * Аккаунт принадлежит одному агентству, и приглашение на занятый ящик
       * вело в тупик: письмо уходило, квота тратилась, а приглашённый видел
       * «ask your teammate to invite a different address». Говорим это тому,
       * кто приглашает, — до письма. Исключение — убранный участник с тем же
       * адресом: его возвращает вход (`reactivateByInvitation`).
       */
      if (!(await hit(`invite-lookup:${ctx.user.agencyId}`, INVITE_LOOKUPS_PER_DAY, 24 * 60 * 60))) {
        throw new TRPCError({
          code: "TOO_MANY_REQUESTS",
          message: "That is a lot of invitations for one day. Try again tomorrow.",
        });
      }
      const existing = await findUserByCanonicalEmail(ctx.db, canonicalEmail(email));
      if (existing && !(existing.deactivatedAt && existing.email.toLowerCase() === email)) {
        throw new TRPCError({
          code: "CONFLICT",
          // Чужой адрес в другом написании не называем: это уже не наш участник.
          message:
            existing.agencyId !== ctx.user.agencyId
              ? `${email} already has its own Answertally workspace, and an account belongs to one workspace. Invite a different address.`
              : existing.deactivatedAt
                ? `This person was in your workspace as ${existing.email}. Invite that address to bring them back.`
                : `${existing.email} is already on your team.`,
        });
      }

      await assertMayInvite(ctx.db, ctx.user.agencyId);
      const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

      // Повтор на адрес, который уже ждёт, освежает то же приглашение.
      const pending = (await listInvitationsByAgency(ctx.db, ctx.user.agencyId)).find(
        (invite) => invite.email.toLowerCase() === email && invite.expiresAt.getTime() > Date.now(),
      );
      const invitation = pending
        ? await refreshInvitation(ctx.db, pending.id, ctx.user.agencyId, {
            role: input.role,
            expiresAt,
          })
        : await createInvitation(ctx.db, {
            agencyId: ctx.user.agencyId,
            email,
            role: input.role,
            token: randomBytes(24).toString("hex"),
            expiresAt,
          });
      const token = invitation.token;
      // Абсолютная: её копируют в Slack и почту, где путь без домена мёртв.
      const inviteUrl = `${appUrl()}/invite/${token}`;

      const agency = await getAgencyById(ctx.db, ctx.user.agencyId);

      /**
       * Письмо — удобство, а не условие: без почтового ключа продукт обязан
       * оставаться рабочим, поэтому ссылка возвращается всегда и показывается
       * в интерфейсе. Отказ транспорта не отменяет уже созданное приглашение.
       */
      let delivered = false;
      try {
        await getEmailSender().send(
          inviteEmail({
            to: input.email,
            agencyName: agency?.name ?? "your agency",
            role: input.role,
            inviteUrl,
            invitedByName: ctx.user.name,
            // Отвечают приглашённые тому, кто позвал, а не адресу отправки.
            invitedByEmail: ctx.user.email,
          }),
        );
        delivered = true;
      } catch (error) {
        console.error(`[invite] delivery failed for ${input.email}`, error);
      }

      return { id: invitation.id, token, inviteUrl, expiresAt, delivered };
    }),

  /** Публичная проверка приглашения — нужна на /invite/[token] до регистрации. */
  inviteInfo: publicProcedure
    .input(z.object({ token: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const invitation = await getInvitationByToken(ctx.db, input.token);

      if (!invitation || invitation.accepted || invitation.expiresAt.getTime() < Date.now()) {
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      const agency = await getAgencyById(ctx.db, invitation.agencyId);
      return { email: invitation.email, role: invitation.role, agencyName: agency?.name ?? null };
    }),
});
