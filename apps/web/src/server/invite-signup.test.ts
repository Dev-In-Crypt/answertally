import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { createAgency, createDb, createInvitation, deleteAgency, getUserByEmail } from "@repo/db";
import { auth } from "@/lib/auth";

/**
 * В агентство входят только по ссылке приглашения.
 *
 * Раньше регистрация присоединяла по одному совпадению почты: любой мог
 * пригласить чужой адрес, и человек, зарегистрировавшийся сам, молча
 * оказывался в чужом агентстве вместе со своими клиентами.
 */

const { db, close } = createDb();
const createdAgencies: string[] = [];

afterAll(async () => {
  await close();
});

describe("регистрация по приглашению", () => {
  let hostAgencyId = "";
  let email = "";
  let token = "";

  beforeEach(async () => {
    hostAgencyId = (await createAgency(db, { name: "Host Agency", clientLimit: 3 })).id;
    createdAgencies.push(hostAgencyId);
    email = `invitee-${crypto.randomUUID().slice(0, 8)}@agency.test`;
    token = randomBytes(24).toString("hex");
    await createInvitation(db, {
      agencyId: hostAgencyId,
      email,
      role: "admin",
      token,
      expiresAt: new Date(Date.now() + 86_400_000),
    });
  });

  afterEach(async () => {
    for (const id of createdAgencies.splice(0)) {
      await deleteAgency(db, id);
    }
  });

  async function signUp(address: string, body: Record<string, unknown> = {}) {
    await auth.api.signUpEmail({
      body: { email: address, password: "correct-horse-battery", name: "Invitee", ...body },
    });
    const user = await getUserByEmail(db, address.toLowerCase());
    if (user?.agencyId && user.agencyId !== hostAgencyId) {
      createdAgencies.push(user.agencyId);
    }
    return user;
  }

  it("без токена — своё агентство, даже если адрес приглашён", async () => {
    const user = await signUp(email);
    expect(user?.agencyId).not.toBe(hostAgencyId);
    expect(user?.role).toBe("owner");
  });

  it("с токеном и своим адресом — агентство пригласившего", async () => {
    const user = await signUp(email, { inviteToken: token });
    expect(user?.agencyId).toBe(hostAgencyId);
    expect(user?.role).toBe("admin");
  });

  it("чужой токен на другой адрес не работает", async () => {
    const other = `stranger-${crypto.randomUUID().slice(0, 8)}@agency.test`;
    const user = await signUp(other, { inviteToken: token });
    expect(user?.agencyId).not.toBe(hostAgencyId);
  });

  it("регистр букв в адресе приглашения не мешает", async () => {
    const upper = email.toUpperCase();
    const user = await signUp(upper, { inviteToken: token });
    expect(user?.agencyId).toBe(hostAgencyId);
  });
});
