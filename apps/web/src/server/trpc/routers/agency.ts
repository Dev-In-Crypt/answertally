import { randomBytes } from "node:crypto";
import { z } from "zod";
import { assertMayInvite } from "../../email-quota";
import { TRPCError } from "@trpc/server";
import {
  createInvitation,
  deactivateUser,
  getUserById,
  revokeInvitation,
  setUserRole,
  getAgencyById,
  getInvitationByToken,
  listInvitationsByAgency,
  listUsersByAgency,
  updateAgency,
} from "@repo/db";
import { inviteEmail } from "@repo/core";
import { protectedProcedure, roleProcedure, router, publicProcedure } from "../trpc";
import { appUrl, getEmailSender } from "../../email";

const INVITE_TTL_DAYS = 7;

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
        throw new TRPCError({ code: "NOT_FOUND" });
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
        throw new TRPCError({ code: "NOT_FOUND" });
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
      await assertMayInvite(ctx.db, ctx.user.agencyId);
      const token = randomBytes(24).toString("hex");
      const expiresAt = new Date(Date.now() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);

      const invitation = await createInvitation(ctx.db, {
        agencyId: ctx.user.agencyId,
        // Better Auth хранит почту пользователя в нижнем регистре.
        email: input.email.toLowerCase(),
        role: input.role,
        token,
        expiresAt,
      });

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
            inviteUrl: `${appUrl()}/invite/${token}`,
            invitedByName: ctx.user.name,
            // Отвечают приглашённые тому, кто позвал, а не адресу отправки.
            invitedByEmail: ctx.user.email,
          }),
        );
        delivered = true;
      } catch (error) {
        console.error(`[invite] delivery failed for ${input.email}`, error);
      }

      return { id: invitation.id, token, expiresAt, delivered };
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
