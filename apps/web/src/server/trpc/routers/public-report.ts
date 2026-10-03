import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  approveShare,
  getClientById,
  getReportById,
  getShareByToken,
  logActivity,
  setReportStatus,
} from "@repo/db";
import { publicProcedure, router } from "../trpc";

/**
 * Единственный публичный роутер (контракт C6). Без сессии и без tenancy guard —
 * доступ даёт сам токен. Поэтому здесь ровно две операции: прочитать статус
 * и подтвердить. Ничего, что меняло бы данные агентства, тут появиться не может.
 */
export const publicReportRouter = router({
  approve: publicProcedure
    .input(
      z.object({
        token: z.string().min(1),
        // Имя нужно агентству, чтобы знать, кто именно подтвердил.
        name: z.string().min(1).max(200),
      }),
    )
    .mutation(async ({ ctx, input }) => {
      const share = await getShareByToken(ctx.db, input.token);

      if (!share || (share.expiresAt && share.expiresAt.getTime() < Date.now())) {
        // Токен не найден или истёк — одинаковый ответ, чтобы перебор
        // не отличал «нет такого» от «просрочен».
        throw new TRPCError({ code: "NOT_FOUND" });
      }

      if (share.approvedAt || !(await approveShare(ctx.db, input.token, input.name))) {
        return { alreadyApproved: true, approvedAt: share.approvedAt ?? new Date() };
      }

      const report = await getReportById(ctx.db, share.reportId);
      if (report) {
        await setReportStatus(ctx.db, report.id, "approved");

        const client = await getClientById(ctx.db, report.clientId);
        if (client) {
          await logActivity(ctx.db, {
            agencyId: client.agencyId,
            clientId: client.id,
            // Подтверждение делает клиент агентства, а не пользователь системы.
            actorUserId: null,
            eventType: "report_approved",
            payload: { reportId: report.id, approvedByName: input.name },
          });
        }
      }

      return { alreadyApproved: false, approvedAt: new Date() };
    }),
});
