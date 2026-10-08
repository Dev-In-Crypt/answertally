import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SourceClassifier } from "@repo/core";
import {
  createAgency,
  createClient,
  createDb,
  createRun,
  deleteAgency,
  ensureSource,
  getSourceByDomain,
  listResponsesByRun,
  listUnclassifiedSources,
} from "@repo/db";
import { citations, promptClusters, prompts, runSchedules } from "@repo/db/schema/measurement";
import { sources } from "@repo/db/schema/sources";
import { orchestrateRun } from "./run-orchestration";
import { classifyRunSources } from "./classify-sources";
import { makePaying } from "./test-support";

/** Verify T30 на стороне БД: домены цитат заводятся и классифицируются правилами. */

const { db, close } = createDb();

describe("classifyRunSources", () => {
  let agencyId = "";
  let runId = "";

  beforeEach(async () => {
    // sources — глобальная таблица-кэш и не удаляется вместе с агентством.
    // Без явной очистки тесты зависели бы от порядка запуска: второй тест
    // видел бы домены уже классифицированными и не вызывал бы классификатор.
    await db.delete(sources);

    const agency = await createAgency(db, { name: "Sources Agency", clientLimit: 10 });
    agencyId = agency.id;
    // Фикстуры цитат — ответа ChatGPT; ChatGPT с 08.10.2026 спрашивается только у платящих.
    await makePaying(db, agencyId);

    const client = await createClient(db, {
      agencyId,
      // Домен клиента совпадает с доменом в fixture-цитатах: проверяем owned.
      name: "AcmeCRM",
      domain: "acmecrm.test",
      brandNames: ["AcmeCRM"],
      competitorNames: ["Northstack"],
    });

    const clusterId = (
      await db
        .insert(promptClusters)
        .values({ clientId: client.id, name: "c", intent: "comparison" })
        .returning()
    )[0]!.id;

    await db.insert(prompts).values([{ clusterId, text: "best CRM for startups" }]);

    const scheduleId = (
      await db
        .insert(runSchedules)
        .values({ clientId: client.id, platforms: ["chatgpt"], samplesPerPrompt: 1 })
        .returning()
    )[0]!.id;

    runId = (await createRun(db, { clientId: client.id, scheduleId, trigger: "manual" })).id;
    await orchestrateRun(db, runId, "mock");

    /**
     * Одна цитата на настоящий домен из словаря — руками, поверх фикстур.
     *
     * В демо-данных настоящих компаний нет намеренно: выдуманные цифры о
     * реальной компании — это ложь о ней. Но словарь `domains.ts` — это как
     * раз знание о настоящем мире, и путь «классифицировано правилом» без
     * такого домена не проходит вовсе: в фикстурах остались только зоны
     * `.example` и `.test`, которых в словаре нет и быть не должно.
     * Проверка «модель не может переспорить словарь» стоит одной цитаты.
     */
    const [response] = await listResponsesByRun(db, runId);
    await db.insert(citations).values({
      responseId: response!.id,
      url: "https://www.g2.com/categories/crm",
      domain: "g2.com",
      title: "Best CRM Software",
      position: 99,
    });
  });

  afterEach(async () => {
    await deleteAgency(db, agencyId);
  });

  afterAll(async () => {
    await close();
  });

  it("заводит источники по процитированным доменам", async () => {
    const outcome = await classifyRunSources(db, runId);

    expect(outcome.domains).toBeGreaterThan(0);
    expect(await getSourceByDomain(db, "reviewgrid.example")).toBeDefined();
  });

  it("известные домены классифицируются правилом", async () => {
    await classifyRunSources(db, runId);

    // Домен из словаря — та самая цитата, добавленная руками выше.
    const g2 = await getSourceByDomain(db, "g2.com");
    expect(g2?.sourceType).toBe("review");
    // Видно, чем классифицирован — правилом или моделью.
    expect(g2?.classifiedBy).toBe("rule");
  });

  it("домен клиента не записывается owned в общую таблицу", async () => {
    await classifyRunSources(db, runId);

    // Владение — свойство пары (клиент, домен), а `sources` общая на все
    // агентства: запись «owned» сделала бы этот домен собственным и для
    // чужого клиента, который его процитировал. Признак ставится при чтении
    // (см. listCitationFacts и owned-domain.test.ts).
    const own = await getSourceByDomain(db, "acmecrm.test");
    expect(own).toBeDefined();
    expect(own?.sourceType).not.toBe("owned");
  });

  it("домен вне словаря классифицируется моделью", async () => {
    const outcome = await classifyRunSources(db, runId);

    // blog.crmdigest.example словарём не покрыт, но подсказка «blog» в домене
    // позволяет классификатору отнести его к editorial.
    expect(outcome.classifiedByModel).toBeGreaterThan(0);
    const blog = await getSourceByDomain(db, "blog.crmdigest.example");
    expect(blog?.sourceType).toBe("editorial");
    expect(blog?.classifiedBy).toBe("model");
  });

  it("классификатор не вызывается повторно для уже известного домена", async () => {
    const spy = vi.fn().mockResolvedValue("editorial");
    const classifier: SourceClassifier = { classify: spy };

    await classifyRunSources(db, runId, classifier);
    const callsAfterFirst = spy.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThan(0);

    // Verify T31: sources — постоянный кэш, второй прогон не платит заново.
    await classifyRunSources(db, runId, classifier);
    expect(spy.mock.calls.length).toBe(callsAfterFirst);
  });

  it("классификатор без уверенности оставляет домен без типа", async () => {
    const classifier: SourceClassifier = { classify: vi.fn().mockResolvedValue(null) };

    const outcome = await classifyRunSources(db, runId, classifier);
    const unclassified = await listUnclassifiedSources(db);

    expect(outcome.unclassified).toBeGreaterThan(0);
    expect(unclassified.some((s) => s.domain === "blog.crmdigest.example")).toBe(true);
  });

  it("повторная классификация не плодит источники", async () => {
    const first = await classifyRunSources(db, runId);
    const second = await classifyRunSources(db, runId);

    expect(second.domains).toBe(first.domains);
  });

  it("уже классифицированный источник не перезаписывается", async () => {
    await ensureSource(db, "manual-check.example", {
      sourceType: "editorial",
      classifiedBy: "human",
    });

    await ensureSource(db, "manual-check.example", {
      sourceType: "ugc",
      classifiedBy: "rule",
    });

    // Иначе более точная ручная или модельная классификация затиралась бы правилом.
    const source = await getSourceByDomain(db, "manual-check.example");
    expect(source?.sourceType).toBe("editorial");
    expect(source?.classifiedBy).toBe("human");
  });
});
