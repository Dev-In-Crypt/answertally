import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { generateApiKey } from "@repo/core";
import { createAgency, createApiKey, createClient, createDb, deleteAgency } from "@repo/db";
import { GET as getClients } from "@/app/api/v1/clients/route";
import { GET as getVisibility } from "@/app/api/v1/clients/[id]/visibility/route";
import { resetRateLimit } from "./api-auth";

/**
 * Verify T96: ключ пускает только к своему агентству, отозванный не пускает
 * вовсе, а чужой клиент неотличим от несуществующего (инвариант 1).
 */

const { db, close } = createDb();

afterAll(async () => {
  await close();
});

function request(token: string | null, url = "http://localhost/api/v1/clients"): Request {
  return new Request(url, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

describe("public API v1", () => {
  let agencyId = "";
  let otherAgencyId = "";
  let clientId = "";
  let foreignClientId = "";
  let token = "";

  beforeEach(async () => {
    resetRateLimit();

    const agency = await createAgency(db, { name: "API Agency", clientLimit: 10 });
    agencyId = agency.id;
    const other = await createAgency(db, { name: "Other Agency", clientLimit: 10 });
    otherAgencyId = other.id;

    clientId = (await createClient(db, { agencyId, name: "Ledgerbrook", domain: "lb.test" })).id;
    foreignClientId = (
      await createClient(db, { agencyId: otherAgencyId, name: "Secret", domain: "secret.test" })
    ).id;

    const key = await generateApiKey();
    token = key.token;
    await createApiKey(db, {
      agencyId,
      name: "Test key",
      prefix: key.prefix,
      hash: key.hash,
    });
  });

  afterEach(async () => {
    await deleteAgency(db, agencyId);
    await deleteAgency(db, otherAgencyId);
  });

  it("свой ключ читает своих клиентов", async () => {
    const response = await getClients(request(token));
    const body = (await response.json()) as { data: { id: string; name: string }[] };

    expect(response.status).toBe(200);
    expect(body.data.map((row) => row.name)).toEqual(["Ledgerbrook"]);
  });

  it("без ключа доступа нет", async () => {
    expect((await getClients(request(null))).status).toBe(401);
  });

  it("выдуманный ключ не пускает", async () => {
    const response = await getClients(request("cw_live_abcdefgh_" + "a".repeat(32)));
    expect(response.status).toBe(401);
  });

  it("отозванный ключ перестаёт работать", async () => {
    const key = await generateApiKey();
    await createApiKey(db, {
      agencyId,
      name: "Revoked",
      prefix: key.prefix,
      hash: key.hash,
      revokedAt: new Date(),
    });

    expect((await getClients(request(key.token))).status).toBe(401);
  });

  it("чужой клиент неотличим от несуществующего", async () => {
    const response = await getVisibility(
      request(token, `http://localhost/api/v1/clients/${foreignClientId}/visibility`),
      { params: Promise.resolve({ id: foreignClientId }) },
    );

    expect(response.status).toBe(404);
  });

  it("мусор вместо идентификатора — 404, а не 500", async () => {
    const response = await getVisibility(
      request(token, "http://localhost/api/v1/clients/not-a-uuid/visibility"),
      { params: Promise.resolve({ id: "not-a-uuid" }) },
    );

    expect(response.status).toBe(404);
  });

  it("видимость отдаётся с интервалом и признаком различимости", async () => {
    const response = await getVisibility(
      request(token, `http://localhost/api/v1/clients/${clientId}/visibility`),
      { params: Promise.resolve({ id: clientId }) },
    );
    const body = (await response.json()) as {
      data: { totals: { interval: unknown }; totalsDistinguishable: boolean; windowDays: number };
    };

    expect(response.status).toBe(200);
    expect(body.data.windowDays).toBe(28);
    expect(body.data).toHaveProperty("totalsDistinguishable");
    expect(body.data.totals).toHaveProperty("interval");
  });

  it("окно вне допустимого отвергается понятной ошибкой", async () => {
    const response = await getVisibility(
      request(token, `http://localhost/api/v1/clients/${clientId}/visibility?windowDays=400`),
      { params: Promise.resolve({ id: clientId }) },
    );

    expect(response.status).toBe(400);
  });
});
