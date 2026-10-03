import { randomBytes } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  createInvitation,
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
        logoUrl: z.string().max(2000).nullable().optional(),
        brandColor: z
          .string()
          .regex(/^#[0-9a-fA-F]{6}$/, "Use a hex colour like #4f46e5")
          .optional(),
      }),
    )
    .mutation(({ ctx, input }) => updateAgency(ctx.db, ctx.user.agencyId, input)),

  members: protectedProcedure.query(async ({ ctx }) => {
    const members = await listUsersByAgency(ctx.db, ctx.user.agencyId);
    return members.map((m) => ({ id: m.id, email: m.email, name: m.name, role: m.role }));
  }),

  // Без токенов: по токену входят в агентство, и видеть его рядовому
  // участнику незачем — ссылку показывают тому, кто приглашал, один раз.
  invites: protectedProcedure.query(async ({ ctx }) =>
    (await listInvitationsByAgency(ctx.db, ctx.user.agencyId)).map((invite) => ({
      id: invite.id,
      email: invite.email,
      role: invite.role,
      expiresAt: invite.expiresAt,
    })),
  ),

  invite: roleProcedure("admin")
    .input(z.object({ email: z.email(), role: z.enum(["admin", "member"]).default("member") }))
    .mutation(async ({ ctx, input }) => {
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
