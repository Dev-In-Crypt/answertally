import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createAgency,
  createClient,
  createDb,
  deleteAgency,
  listPromptClusters,
  listPromptsByClient,
} from "@repo/db";
import { appRouter } from "./root";
import type { SessionUser, TrpcContext } from "./context";

/** Verify T60: генерация промптов даёт черновик, сохраняется только правленый список. */

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

describe("prompts.generate / saveGenerated", () => {
  let agencyId = "";
  let clientId = "";

  beforeEach(async () => {
    const agency = await createAgency(db, { name: "Audit Agency", clientLimit: 10 });
    agencyId = agency.id;
    const client = await createClient(db, {
      agencyId,
      name: "AcmeCRM",
      domain: "acmecrm.test",
      industry: "CRM software",
      brandNames: ["AcmeCRM", "Acme"],
      competitorNames: ["Northstack", "Pipewell"],
      status: "prospect",
    });
    clientId = client.id;
  });

  afterEach(async () => {
    await deleteAgency(db, agencyId);
  });

  it("генерация ничего не сохраняет — это черновик", async () => {
    const result = await caller(agencyId).prompts.generate({ clientId });

    expect(result.prompts.length).toBeGreaterThanOrEqual(20);
    expect(await listPromptsByClient(db, clientId)).toHaveLength(0);
    expect(await listPromptClusters(db, clientId)).toHaveLength(0);
  });

  it("черновик использует домен, бренд и конкурентов клиента", async () => {
    const { prompts } = await caller(agencyId).prompts.generate({ clientId, count: 30 });
    const texts = prompts.map((prompt) => prompt.text);

    expect(texts).toContain("AcmeCRM vs Northstack");
    expect(texts).toContain("alternatives to Pipewell");
    expect(texts.some((text) => text.includes("crm software"))).toBe(true);
  });

  it("индустрия из формы перекрывает сохранённую у клиента", async () => {
    const { prompts } = await caller(agencyId).prompts.generate({
      clientId,
      industry: "field service software",
    });

    expect(prompts.some((prompt) => prompt.text.includes("field service software"))).toBe(true);
    expect(prompts.every((prompt) => !prompt.text.includes("crm software"))).toBe(true);
  });

  it("сохраняется ровно то, что прислали, включая правки", async () => {
    const { prompts } = await caller(agencyId).prompts.generate({ clientId });
    const edited = prompts.slice(0, 5).map((prompt, index) =>
      index === 0 ? { ...prompt, text: "edited by hand" } : prompt,
    );

    const result = await caller(agencyId).prompts.saveGenerated({ clientId, prompts: edited });

    const saved = await listPromptsByClient(db, clientId);
    expect(saved).toHaveLength(5);
    expect(result.createdPrompts).toBe(5);
    expect(saved.map((prompt) => prompt.text)).toContain("edited by hand");
  });

  it("кластеры создаются по именам из черновика и не дублируются при повторном сохранении", async () => {
    const { prompts } = await caller(agencyId).prompts.generate({ clientId });
    const half = prompts.slice(0, 8);

    const first = await caller(agencyId).prompts.saveGenerated({ clientId, prompts: half });
    const second = await caller(agencyId).prompts.saveGenerated({ clientId, prompts: half });

    expect(second.createdClusters).toBe(0);
    expect(first.createdClusters).toBeGreaterThan(0);

    const clusters = await listPromptClusters(db, clientId);
    expect(clusters).toHaveLength(first.createdClusters);

    // Повторное сохранение не удваивает вопросы, а называет пропущенные.
    expect(second).toMatchObject({ createdPrompts: 0, alreadyTracked: 8 });
    expect(await listPromptsByClient(db, clientId)).toHaveLength(8);
  });

  it("контрольные промпты сохраняются как контрольные", async () => {
    const { prompts } = await caller(agencyId).prompts.generate({ clientId, count: 30 });
    await caller(agencyId).prompts.saveGenerated({ clientId, prompts });

    const saved = await listPromptsByClient(db, clientId);
    expect(saved.some((prompt) => prompt.isControl)).toBe(true);
  });

  it("чужой клиент неотличим от несуществующего", async () => {
    const other = await createAgency(db, { name: "Other", clientLimit: 10 });
    try {
      await expect(caller(other.id).prompts.generate({ clientId })).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    } finally {
      await deleteAgency(db, other.id);
    }
  });
});

describe("потолок вопросов на клиента", () => {
  let agencyId = "";
  let clientId = "";

  beforeEach(async () => {
    agencyId = (await createAgency(db, { name: "Cap Agency", clientLimit: 3 })).id;
    clientId = (await createClient(db, { agencyId, name: "Cap", domain: "cap.test" })).id;
  });

  afterEach(async () => {
    await deleteAgency(db, agencyId);
  });

  function csvOf(count: number): string {
    const rows = Array.from({ length: count }, (_, i) => `Cluster,other,question ${i},false`);
    return ["cluster,intent,prompt,is_control", ...rows].join("\n");
  }

  it("файл, который не помещается в 100 вопросов, не импортируется вовсе", async () => {
    // Раньше одна загрузка добавляла клиенту десятки тысяч вопросов.
    await expect(
      caller(agencyId).prompts.importCsv({ clientId, csv: csvOf(101) }),
    ).rejects.toThrow(/up to 100 active prompts/);
    expect(await listPromptsByClient(db, clientId)).toHaveLength(0);
  });

  it("повторный импорт исправленного файла добавляет только новое", async () => {
    await caller(agencyId).prompts.importCsv({ clientId, csv: csvOf(60) });
    // Тот же файл плюс строка: дубли не съедают потолок и не удваиваются.
    const again = await caller(agencyId).prompts.importCsv({
      clientId,
      csv: `${csvOf(60)}\nCluster,other,  QUESTION 0 ,false\nCluster,other,brand new,false`,
    });

    expect(again).toMatchObject({ createdPrompts: 1, alreadyTracked: 60 });
    expect(await listPromptsByClient(db, clientId)).toHaveLength(61);
  });

  it("сотый вопрос добавляется, сто первый — нет", async () => {
    await caller(agencyId).prompts.importCsv({ clientId, csv: csvOf(99) });
    const [cluster] = await listPromptClusters(db, clientId);

    await caller(agencyId).prompts.create({ clusterId: cluster!.id, text: "one hundred" });
    await expect(
      caller(agencyId).prompts.create({ clusterId: cluster!.id, text: "one hundred one" }),
    ).rejects.toThrow(/up to 100 active prompts/);
  });
});
