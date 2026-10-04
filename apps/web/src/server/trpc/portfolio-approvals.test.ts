import { afterAll, afterEach, beforeEach, expect, it } from "vitest";
import {
  createAgency,
  createClient,
  createDb,
  deleteAgency,
  listPortfolioRows,
  upsertVisibilitySnapshot,
} from "@repo/db";
import { appRouter } from "./root";
import type { SessionUser, TrpcContext } from "./context";

/**
 * «Отчёты на согласовании» на главной считают отчёты, а не ссылки:
 * отозванная ссылка не в счёт, повторно выданная не удваивает отчёт.
 */

const { db, close } = createDb();
afterAll(async () => {
  await close();
});

let agencyId = "";
let clientId = "";

beforeEach(async () => {
  agencyId = (await createAgency(db, { name: "Approvals Agency", clientLimit: 10 })).id;
  clientId = (
    await createClient(db, { agencyId, name: "AcmeCRM", domain: "acmecrm.test", competitorNames: [] })
  ).id;
  for (const week of ["2026-08-03T00:00:00Z", "2026-08-24T00:00:00Z"]) {
    await upsertVisibilitySnapshot(db, {
      clientId,
      clusterId: null,
      platform: null,
      periodStart: new Date(week),
      periodEnd: new Date(new Date(week).getTime() + 7 * 86_400_000),
      clientVisibilityPct: "30.0",
      competitorVisibility: {},
      sampleCount: 30,
      sufficient: true,
    });
  }
});

afterEach(async () => {
  await deleteAgency(db, agencyId);
});

it("считается отчёт с живой неподтверждённой ссылкой, по одному на отчёт", async () => {
  const user: SessionUser = {
    id: crypto.randomUUID(),
    email: "owner@test.local",
    name: "Owner",
    agencyId,
    role: "owner",
  };
  const api = appRouter.createCaller({ db, user } as TrpcContext);
  const pending = async () =>
    (await listPortfolioRows(db, agencyId)).find((row) => row.clientId === clientId)
      ?.reportsAwaitingApproval;

  const report = await api.reports.generate({
    clientId,
    periodStart: "2026-08-03T00:00:00.000Z",
    periodEnd: "2026-08-31T00:00:00.000Z",
  });
  expect(await pending()).toBe(0);

  await api.reports.share({ reportId: report.id });
  expect(await pending()).toBe(1);

  await api.reports.revokeShare({ reportId: report.id });
  expect(await pending()).toBe(0);

  // Новая ссылка после отзыва: две строки ссылок, один отчёт.
  await api.reports.share({ reportId: report.id });
  expect(await pending()).toBe(1);
});
