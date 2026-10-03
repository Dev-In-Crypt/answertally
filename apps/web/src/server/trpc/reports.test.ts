import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryEmailSender, REPORT_COPY, reportPayloadSchema } from "@repo/core";
import {
  createAgency,
  createClient,
  createDb,
  deleteAgency,
  getShareByToken,
  listActivity,
  upsertSubscription,
  upsertVisibilitySnapshot,
} from "@repo/db";
import { appRouter } from "./root";
import type { SessionUser, TrpcContext } from "./context";
import { setEmailSender } from "../email";

/** Verify T50: payload валиден по схеме, числа совпадают с ручным расчётом. */

const { db, close } = createDb();

afterAll(async () => {
  await close();
});

function caller(agencyId: string) {
  const user: SessionUser = {
    id: crypto.randomUUID(),
    email: "owner@test.local",
    name: "Owner",
    agencyId,
    role: "owner",
  };
  return appRouter.createCaller({ db, user } as TrpcContext);
}

const PERIOD_START = new Date("2026-08-03T00:00:00Z");
const PERIOD_END = new Date("2026-08-31T00:00:00Z");

describe("reports.generate", () => {
  let agencyId = "";
  let clientId = "";

  beforeEach(async () => {
    const agency = await createAgency(db, { name: "Report Agency", clientLimit: 10 });
    agencyId = agency.id;
    const client = await createClient(db, {
      agencyId,
      name: "AcmeCRM",
      domain: "acmecrm.test",
      competitorNames: ["Northstack"],
    });
    clientId = client.id;

    // Свёртки по всему клиенту: 23% в начале периода, 31% в конце.
    // Конкурент держится на 37% — разрыв −14 pp превращается в −6 pp.
    const weeks: [string, number][] = [
      ["2026-08-03T00:00:00Z", 23],
      ["2026-08-24T00:00:00Z", 31],
    ];

    for (const [week, pct] of weeks) {
      await upsertVisibilitySnapshot(db, {
        clientId,
        clusterId: null,
        platform: null,
        periodStart: new Date(week),
        periodEnd: new Date(new Date(week).getTime() + 7 * 24 * 60 * 60 * 1000),
        clientVisibilityPct: pct.toFixed(1),
        competitorVisibility: { Northstack: 37 },
        sampleCount: 30,
        sufficient: true,
      });
    }
  });

  afterEach(async () => {
    await deleteAgency(db, agencyId);
  });

  async function generate() {
    return caller(agencyId).reports.generate({
      clientId,
      periodStart: PERIOD_START.toISOString(),
      periodEnd: PERIOD_END.toISOString(),
    });
  }

  it("payload проходит валидацию схемы C4", async () => {
    const report = await generate();
    expect(() => reportPayloadSchema.parse(report.payload)).not.toThrow();
  });

  it("числа совпадают с ручным расчётом", async () => {
    const report = await generate();
    const payload = reportPayloadSchema.parse(report.payload);

    expect(payload.client.name).toBe("AcmeCRM");
    expect(payload.visibility).toEqual({ before: 23, after: 31 });
    expect(payload.results.visibilityDeltaPp).toBe(8);
    // 23 − 37 = −14 pp в начале, 31 − 37 = −6 pp в конце.
    expect(payload.competitorGap).toEqual({ before: -14, after: -6 });
  });

  it("переходы попадают в отчёт только если их импортировали", async () => {
    const withoutTraffic = reportPayloadSchema.parse((await generate()).payload);
    // Пустая таблица читалась бы клиентом как «переходов не было».
    expect(withoutTraffic.assistantTraffic).toBeUndefined();

    await caller(agencyId).analytics.importTraffic({
      clientId,
      // Дата внутри периода отчёта, а не «сегодня»: период зафиксирован, и
      // тест, привязанный к текущему дню, ломался бы, как только день выйдет
      // за его границы.
      csv: ["date,source,sessions", "2026-08-10,chatgpt.com,17"].join("\n"),
    });

    const withTraffic = reportPayloadSchema.parse((await generate()).payload);
    expect(withTraffic.assistantTraffic).toMatchObject({
      totalSessions: 17,
      byAssistant: [{ assistant: "chatgpt", sessions: 17 }],
    });
  });

  it("до оплаты отчёт письмом не отправляется — только ссылкой", async () => {
    // Иначе это рассылка фишинга от нашего домена: название агентства и
    // приписку задаёт сам пользователь.
    const report = await generate();
    await expect(
      caller(agencyId).reports.send({ reportId: report.id, to: "x@example.test" }),
    ).rejects.toThrow(/Copy the client link/);
  });

  it("отправка отчёта письмом даёт ссылку и попадает в журнал", async () => {
    const mailbox = new MemoryEmailSender();
    setEmailSender(mailbox);
    await upsertSubscription(db, {
      agencyId,
      customerId: `cus_${agencyId.slice(0, 8)}`,
      subscriptionId: `sub_${agencyId.slice(0, 8)}`,
      plan: "starter",
      status: "active",
      currentPeriodEnd: new Date("2099-01-01T00:00:00.000Z"),
      cancelAtPeriodEnd: false,
    });

    try {
      const report = await generate();
      const result = await caller(agencyId).reports.send({
        reportId: report.id,
        to: "finance@ledgerbrook.test",
        note: "Numbers for the quarter.",
      });

      expect(result.sent).toBe(true);

      const message = mailbox.lastTo("finance@ledgerbrook.test");
      expect(message?.text).toContain(`/r/${result.token}`);
      // White-label: письмо подписано агентством, названия продукта в нём нет.
      expect(message?.text).toContain("Report Agency");
      expect(message?.text).not.toMatch(/answertally/i);
      expect(message?.text).toContain("Numbers for the quarter.");

      const activity = await listActivity(db, clientId, 10);
      expect(activity.some((entry) => entry.eventType === "report_shared")).toBe(true);
    } finally {
      setEmailSender(null);
    }
  });

  it("ссылка на отчёт живёт 90 дней и отзывается", async () => {
    // Так обещано в политике и DPA; раньше ссылка была вечной.
    const report = await generate();
    const { token } = await caller(agencyId).reports.share({ reportId: report.id });

    const share = await getShareByToken(db, token);
    const days = (share!.expiresAt!.getTime() - Date.now()) / 86_400_000;
    expect(Math.round(days)).toBe(90);

    await caller(agencyId).reports.revokeShare({ reportId: report.id });
    await expect(
      caller(agencyId).publicReport.approve({ token, name: "Late Reader" }),
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const next = await caller(agencyId).reports.share({ reportId: report.id });
    expect(next.token).not.toBe(token);
  });

  it("вопрос без сравнимой выборки не попадает в «что изменилось»", async () => {
    const report = await generate();
    const payload = reportPayloadSchema.parse(report.payload);

    // У этого клиента ответов за период нет вовсе, поэтому раздела быть не
    // должно: пустая строка «0 pp» означала бы «не изменилось», хотя верное
    // утверждение — «не измерено».
    expect(payload.movement ?? []).toEqual([]);
  });

  it("раздел «что сделано» собирается из завершённых действий периода", async () => {
    const api = caller(agencyId);
    const { setActionCompletedAt } = await import("@repo/db");

    for (const title of ["Refresh A", "Refresh B"]) {
      const action = await api.actions.create({
        clientId,
        title,
        reason: "The page is cited but stale.",
        actionType: "refresh_page",
        estimatedImpact: "medium",
        effort: "low",
        affectedClusterIds: [],
      });
      await api.actions.update({ id: action.id, status: "done" });
      await setActionCompletedAt(db, action.id, new Date("2026-08-15T00:00:00Z"));
    }

    // Действие вне периода в отчёт попасть не должно.
    const outside = await api.actions.create({
      clientId,
      title: "Old work",
      reason: "Done long ago.",
      actionType: "create_page",
      estimatedImpact: "low",
      effort: "low",
      affectedClusterIds: [],
    });
    await api.actions.update({ id: outside.id, status: "done" });
    await setActionCompletedAt(db, outside.id, new Date("2026-05-01T00:00:00Z"));

    const payload = reportPayloadSchema.parse((await generate()).payload);

    expect(payload.workCompleted).toEqual([{ label: "Pages refreshed", count: 2 }]);
  });

  it("незавершённые действия попадают в следующий спринт", async () => {
    await caller(agencyId).actions.create({
      clientId,
      title: "Editorial outreach",
      reason: "Forbes is cited in 12% of answers; the client is absent.",
      actionType: "pr_editorial",
      estimatedImpact: "high",
      effort: "medium",
      affectedClusterIds: [],
    });

    const payload = reportPayloadSchema.parse((await generate()).payload);
    expect(payload.nextSprint).toContain("Editorial outreach");
  });

  it("оговорка о природе измерения есть в каждом отчёте", async () => {
    const payload = reportPayloadSchema.parse((await generate()).payload);

    // Клиент должен понимать, что именно измерено, даже если агентство
    // не стало объяснять.
    expect(payload.caveats).toContain(REPORT_COPY.measurementBasis);
    // Период короче 60 дней — предупреждение о раннем сигнале.
    expect(payload.caveats).toContain(REPORT_COPY.shortPeriod);
  });

  it("генерация попадает в журнал активности", async () => {
    const report = await generate();
    const entries = await listActivity(db, clientId);

    const event = entries.find((entry) => entry.eventType === "report_generated");
    expect(event?.payload["reportId"]).toBe(report.id);
  });

  it("ссылка выдаётся один раз и не меняется", async () => {
    const report = await generate();
    const api = caller(agencyId);

    const first = await api.reports.share({ reportId: report.id });
    const second = await api.reports.share({ reportId: report.id });

    expect(first.created).toBe(true);
    expect(second.created).toBe(false);
    // Ссылку уже отправили клиенту — менять её при повторном нажатии нельзя.
    expect(second.token).toBe(first.token);
    expect(first.token.length).toBeGreaterThan(40);
  });

  it("отчёт чужого агентства недоступен", async () => {
    const report = await generate();
    const other = await createAgency(db, { name: "Other Reports" });

    await expect(caller(other.id).reports.get({ id: report.id })).rejects.toThrow();

    await deleteAgency(db, other.id);
  });

  it("сохранённый payload не пересчитывается при чтении", async () => {
    const report = await generate();

    // Данные меняются после генерации.
    await upsertVisibilitySnapshot(db, {
      clientId,
      clusterId: null,
      platform: null,
      periodStart: new Date("2026-08-24T00:00:00Z"),
      periodEnd: new Date("2026-08-31T00:00:00Z"),
      clientVisibilityPct: "99.0",
      competitorVisibility: { Northstack: 37 },
      sampleCount: 30,
      sufficient: true,
    });

    const stored = reportPayloadSchema.parse(
      (await caller(agencyId).reports.get({ id: report.id })).report.payload,
    );

    // Клиент видел 31%, и документ обязан показывать 31% навсегда.
    expect(stored.visibility.after).toBe(31);
  });
});
