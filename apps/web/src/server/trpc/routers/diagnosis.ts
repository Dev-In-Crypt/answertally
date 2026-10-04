import { z } from "zod";
import { buildRecommendations, diagnose, suggestCompetitors } from "@repo/core";
import { getClientById, listCitationFacts } from "@repo/db";
import { assertTenant, protectedProcedure, router } from "../trpc";
import { clientSources, toCitationFacts } from "../../sources";
import { competitorNameFromDomain } from "../../competitor-name";

export const diagnosisRouter = router({
  /** Граф источников кластера: распределение типов, влиятельные площадки, вывод. */
  sourceGraph: protectedProcedure
    .input(
      z.object({
        clientId: z.uuid(),
        clusterId: z.uuid().nullable().default(null),
        limit: z.number().int().min(5).max(50).default(25),
      }),
    )
    .query(async ({ ctx, input }) => {
      const client = await getClientById(ctx.db, input.clientId);
      assertTenant(client, ctx.user.agencyId);

      // Считает общая функция: тот же диагноз отдаёт публичный API.
      return clientSources(ctx.db, input.clientId, input.clusterId, input.limit);
    }),

  /** Кандидаты в действия. Каждая рекомендация несёт непустой reason (принцип 6). */
  recommendations: protectedProcedure
    .input(z.object({ clientId: z.uuid(), clusterId: z.uuid().nullable().default(null) }))
    .query(async ({ ctx, input }) => {
      const client = await getClientById(ctx.db, input.clientId);
      assertTenant(client, ctx.user.agencyId);

      const facts = toCitationFacts(
        await listCitationFacts(ctx.db, input.clientId, input.clusterId),
      );

      return buildRecommendations(diagnose(facts), input.clusterId ?? undefined);
    }),

  /**
   * Кого ещё стоит отслеживать — по тому, что модели уже цитируют.
   *
   * Не «мы нашли ваших конкурентов», а «эти продуктовые сайты попадают в
   * ответы на ваши же вопросы». Решение остаётся за человеком: список
   * конкурентов задаёт, что вообще считается конкурентом в метриках.
   */
  suggestedCompetitors: protectedProcedure
    .input(z.object({ clientId: z.uuid() }))
    .query(async ({ ctx, input }) => {
      const client = await getClientById(ctx.db, input.clientId);
      assertTenant(client, ctx.user.agencyId);

      const rows = await listCitationFacts(ctx.db, input.clientId);

      const tracked = client.competitorNames.map((name) =>
        name.toLowerCase().replace(/\s+/g, ""),
      );
      // Имя считается здесь, одно на экран и на «уже отслеживается»: иначе
      // добавленный «Hubspot» с blog.hubspot.com снова предлагался бы как новинка.
      return suggestCompetitors(
        rows.map((row) => ({ domain: row.domain, sourceType: row.sourceType })),
        { clientDomain: client.domain, trackedNames: client.competitorNames },
      ).map((row) => {
        const name = competitorNameFromDomain(row.domain);
        return {
          ...row,
          name,
          alreadyTracked: row.alreadyTracked || tracked.includes(name.toLowerCase()),
        };
      });
    }),
});
