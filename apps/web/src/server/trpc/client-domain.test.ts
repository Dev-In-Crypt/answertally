import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { createAgency, createDb, deleteAgency, getClientById } from "@repo/db";
import { appRouter } from "./root";
import type { SessionUser, TrpcContext } from "./context";

/**
 * Домен клиента — ключ, по которому его собственные страницы отличаются от
 * чужих. Если в базу попадёт «https://acme.com/», сравнение с доменом из
 * цитаты не сработает никогда, и диагностика тихо соврёт.
 */

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

describe("домен клиента нормализуется на входе", () => {
  let agencyId = "";

  beforeEach(async () => {
    agencyId = (await createAgency(db, { name: "Domain Agency", clientLimit: 10 })).id;
  });

  afterEach(async () => {
    await deleteAgency(db, agencyId);
  });

  const cases: [string, string][] = [
    ["https://agenciapisto.com/", "agenciapisto.com"],
    ["http://www.acme.com", "acme.com"],
    ["https://acme.com/es/servicios?utm_source=x", "acme.com"],
    ["  ACME.com  ", "acme.com"],
  ];

  for (const [input, expected] of cases) {
    it(`${input} сохраняется как ${expected}`, async () => {
      const client = await caller(agencyId).clients.create({
        name: "Pisto",
        domain: input,
        brandNames: [],
        competitorNames: [],
      });

      expect(client.domain).toBe(expected);
      expect((await getClientById(db, client.id))?.domain).toBe(expected);
    });
  }

  it("правка клиента нормализует домен так же", async () => {
    const client = await caller(agencyId).clients.create({
      name: "Pisto",
      domain: "agenciapisto.com",
      brandNames: [],
      competitorNames: [],
    });

    const updated = await caller(agencyId).clients.update({
      id: client.id,
      domain: "https://www.agenciapisto.com/contacto",
    });

    expect(updated?.domain).toBe("agenciapisto.com");
  });

  it("отрасль стирается явным null, а без ключа остаётся", async () => {
    const client = await caller(agencyId).clients.create({
      name: "Pisto",
      domain: "agenciapisto.com",
      industry: "Marketing agency",
    });

    const untouched = await caller(agencyId).clients.update({ id: client.id, name: "Pisto 2" });
    expect(untouched?.industry).toBe("Marketing agency");

    const cleared = await caller(agencyId).clients.update({ id: client.id, industry: null });
    expect(cleared?.industry).toBeNull();
  });

  it("строка без точки отклоняется с понятным сообщением", async () => {
    await expect(
      caller(agencyId).clients.create({
        name: "Pisto",
        domain: "agenciapisto",
        brandNames: [],
        competitorNames: [],
      }),
    ).rejects.toThrow(/domain/i);
  });
});
