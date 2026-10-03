import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryEmailSender } from "@repo/core";
import { createAgency, createDb, deleteAgency } from "@repo/db";
import { appRouter } from "./root";
import type { SessionUser, TrpcContext } from "./context";
import { setEmailSender } from "../email";

/**
 * Verify T85: приглашение уходит письмом, но не зависит от него — ссылка
 * возвращается всегда, а отказ транспорта не отменяет само приглашение.
 */

const { db, close } = createDb();
const mailbox = new MemoryEmailSender();

afterAll(async () => {
  setEmailSender(null);
  await close();
});

function caller(agencyId: string) {
  const user: SessionUser = {
    id: crypto.randomUUID(),
    email: "owner@test.local",
    name: "Dana Owner",
    agencyId,
    role: "owner",
  };
  return appRouter.createCaller({ db, user } as TrpcContext);
}

describe("agency.invite", () => {
  let agencyId = "";

  beforeEach(async () => {
    mailbox.clear();
    setEmailSender(mailbox);
    const agency = await createAgency(db, { name: "Northwind Studio", clientLimit: 10 });
    agencyId = agency.id;
  });

  afterEach(async () => {
    await deleteAgency(db, agencyId);
  });

  it("письмо содержит ссылку с тем же токеном, что вернула процедура", async () => {
    const result = await caller(agencyId).agency.invite({ email: "new@agency.test" });

    expect(result.delivered).toBe(true);

    const message = mailbox.lastTo("new@agency.test");
    expect(message).toBeDefined();
    expect(message?.text).toContain(`/invite/${result.token}`);
    expect(message?.text).toContain("Northwind Studio");
    // Кто пригласил — иначе письмо неотличимо от спама.
    expect(message?.text).toContain("Dana Owner");
  });

  it("отказ почты не отменяет приглашение", async () => {
    setEmailSender({
      send: () => Promise.reject(new Error("transport is down")),
    });

    const result = await caller(agencyId).agency.invite({ email: "unreachable@agency.test" });

    expect(result.delivered).toBe(false);
    expect(result.token).toHaveLength(48);

    // Приглашение живо: по нему можно зарегистрироваться, ссылку видно в интерфейсе.
    const info = await caller(agencyId).agency.inviteInfo({ token: result.token });
    expect(info.email).toBe("unreachable@agency.test");
  });

  it("до оплаты в ожидании не больше трёх приглашений", async () => {
    // Приглашение — письмо на любой адрес с названием агентства, которое
    // задаёт пользователь. Без границы это рассылка от нашего домена.
    for (const n of [1, 2, 3]) {
      await caller(agencyId).agency.invite({ email: `teammate${n}@agency.test` });
    }
    await expect(
      caller(agencyId).agency.invite({ email: "teammate4@agency.test" }),
    ).rejects.toThrow(/Up to 3 invitations/);
  });

  it("адрес приглашения хранится в нижнем регистре", async () => {
    const result = await caller(agencyId).agency.invite({ email: "Mixed.Case@Agency.test" });
    const info = await caller(agencyId).agency.inviteInfo({ token: result.token });
    expect(info.email).toBe("mixed.case@agency.test");
  });
});
