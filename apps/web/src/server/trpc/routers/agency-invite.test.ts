import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { MemoryEmailSender } from "@repo/core";
import { createAgency, createDb, createUser, deactivateUser, deleteAgency } from "@repo/db";
import { appRouter } from "../root";
import type { SessionUser, TrpcContext } from "../context";
import { setEmailSender } from "../../email";

/**
 * Приглашение не ведёт в тупик: на занятый ящик оно не уходит вовсе, а
 * повтор на тот же адрес освежает прежнее, а не плодит второе.
 */

const { db, close } = createDb();
const mailbox = new MemoryEmailSender();

afterAll(async () => {
  setEmailSender(null);
  await close();
});

describe("agency.invite: занятые и повторные адреса", () => {
  const agencies: string[] = [];
  let agencyId = "";
  let owner: SessionUser;

  function caller() {
    return appRouter.createCaller({ db, user: owner } as TrpcContext);
  }

  beforeEach(async () => {
    mailbox.clear();
    setEmailSender(mailbox);
    agencyId = (await createAgency(db, { name: "Invite Agency", clientLimit: 3 })).id;
    agencies.push(agencyId);
    const tag = crypto.randomUUID().slice(0, 8);
    const created = await createUser(db, {
      agencyId,
      email: `owner-${tag}@invite.test`,
      name: "Owner",
      role: "owner",
    });
    owner = { id: created.id, email: created.email, name: "Owner", agencyId, role: "owner" };
  });

  afterEach(async () => {
    for (const id of agencies.splice(0)) {
      await deleteAgency(db, id);
    }
  });

  it("на ящик с аккаунтом в другом агентстве — понятный отказ и без письма", async () => {
    const otherAgency = (await createAgency(db, { name: "Other", clientLimit: 3 })).id;
    agencies.push(otherAgency);
    const tag = crypto.randomUUID().slice(0, 8);
    await createUser(db, { agencyId: otherAgency, email: `jdoe${tag}@gmail.com`, name: "J" });

    // Другое написание того же ящика Gmail — тот же аккаунт.
    await expect(caller().agency.invite({ email: `j.doe${tag}@gmail.com` })).rejects.toThrow(
      /already has its own Answertally workspace/,
    );
    expect(mailbox.sent).toHaveLength(0);
    expect(await caller().agency.invites()).toHaveLength(0);
  });

  it("на своего участника — «уже в команде»", async () => {
    await expect(caller().agency.invite({ email: owner.email })).rejects.toThrow(
      /already on your team/,
    );
  });

  it("убранного участника пригласить можно — его вернёт вход", async () => {
    const tag = crypto.randomUUID().slice(0, 8);
    const gone = await createUser(db, { agencyId, email: `gone-${tag}@invite.test`, name: "G" });
    await deactivateUser(db, gone.id, agencyId);

    const result = await caller().agency.invite({ email: gone.email });
    expect(result.delivered).toBe(true);
  });

  it("повтор на тот же адрес освежает прежнее приглашение и его ссылку", async () => {
    const first = await caller().agency.invite({ email: "bob@invite.test" });
    const second = await caller().agency.invite({ email: "Bob@invite.test" });

    expect(second.id).toBe(first.id);
    // Ссылка из первого письма продолжает работать.
    expect(second.token).toBe(first.token);
    expect(second.inviteUrl).toMatch(/^https?:\/\/.+\/invite\//);
    expect(await caller().agency.invites()).toHaveLength(1);
    expect(
      mailbox.sent.filter((message) => message.to.toLowerCase() === "bob@invite.test"),
    ).toHaveLength(2);
  });

  it("проверок адреса в сутки — ограниченное число: занятость ящиков не перебрать", async () => {
    // Отказы по квоте приглашений тоже считаются: проверка ящика идёт раньше.
    for (let i = 0; i < 50; i++) {
      await caller()
        .agency.invite({ email: `probe-${i}@invite.test` })
        .catch(() => undefined);
    }
    await expect(caller().agency.invite({ email: "probe-last@invite.test" })).rejects.toThrow(
      /a lot of invitations for one day/,
    );
  });
});
