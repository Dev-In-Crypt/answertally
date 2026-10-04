import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createAgency,
  createDb,
  createUser,
  deleteAgency,
  getUserById,
  reactivateByInvitation,
} from "@repo/db";
import { appRouter } from "./root";
import type { SessionUser, TrpcContext, UserRole } from "./context";

/**
 * Ушедший сотрудник не сохраняет доступ к клиентам агентства.
 *
 * Раньше убрать участника было нельзя вовсе: сессия продлевалась сама, пока
 * ею пользовались, и бывший сотрудник читал всё агентство неделями.
 */

const { db, close } = createDb();

afterAll(async () => {
  await close();
});

function caller(agencyId: string, user: { id: string; role: UserRole }) {
  const session: SessionUser = {
    id: user.id,
    email: `${user.role}@team.test`,
    name: user.role,
    agencyId,
    role: user.role,
  };
  return appRouter.createCaller({ db, user: session } as TrpcContext);
}

describe("команда агентства", () => {
  let agencyId = "";
  let owner = { id: "", role: "owner" as UserRole };
  let admin = { id: "", role: "admin" as UserRole };
  let member = { id: "", role: "member" as UserRole };

  beforeEach(async () => {
    agencyId = (await createAgency(db, { name: "Team Agency", clientLimit: 3 })).id;
    const tag = crypto.randomUUID().slice(0, 8);
    owner = {
      id: (
        await createUser(db, { agencyId, email: `o-${tag}@team.test`, name: "O", role: "owner" })
      ).id,
      role: "owner",
    };
    admin = {
      id: (
        await createUser(db, { agencyId, email: `a-${tag}@team.test`, name: "A", role: "admin" })
      ).id,
      role: "admin",
    };
    member = {
      id: (
        await createUser(db, { agencyId, email: `m-${tag}@team.test`, name: "M", role: "member" })
      ).id,
      role: "member",
    };
  });

  afterEach(async () => {
    await deleteAgency(db, agencyId);
  });

  it("убранный участник пропадает из команды, а строка остаётся", async () => {
    await caller(agencyId, admin).agency.removeMember({ userId: member.id });

    const members = await caller(agencyId, owner).agency.members();
    expect(members.map((m) => m.id)).not.toContain(member.id);
    expect((await getUserById(db, member.id))?.deactivatedAt).toBeInstanceOf(Date);
  });

  it("администратора убирает только владелец", async () => {
    const other = (
      await createUser(db, {
        agencyId,
        email: `a2-${crypto.randomUUID().slice(0, 8)}@team.test`,
        name: "A2",
        role: "admin",
      })
    ).id;

    await expect(caller(agencyId, admin).agency.removeMember({ userId: other })).rejects.toThrow(
      /owner/,
    );
    await caller(agencyId, owner).agency.removeMember({ userId: other });
  });

  it("владельца и себя убрать нельзя, участник не убирает никого", async () => {
    await expect(
      caller(agencyId, admin).agency.removeMember({ userId: owner.id }),
    ).rejects.toThrow();
    await expect(
      caller(agencyId, admin).agency.removeMember({ userId: admin.id }),
    ).rejects.toThrow();
    await expect(
      caller(agencyId, member).agency.removeMember({ userId: admin.id }),
    ).rejects.toThrow();
  });

  it("чужого участника не видно", async () => {
    const otherAgency = (await createAgency(db, { name: "Other", clientLimit: 3 })).id;
    try {
      const stranger = (
        await createUser(db, {
          agencyId: otherAgency,
          email: `s-${crypto.randomUUID().slice(0, 8)}@team.test`,
          name: "S",
        })
      ).id;
      await expect(
        caller(agencyId, owner).agency.removeMember({ userId: stranger }),
      ).rejects.toMatchObject({
        code: "NOT_FOUND",
      });
    } finally {
      await deleteAgency(db, otherAgency);
    }
  });

  it("роль меняет только владелец", async () => {
    await expect(
      caller(agencyId, admin).agency.changeRole({ userId: member.id, role: "admin" }),
    ).rejects.toThrow();
    await caller(agencyId, owner).agency.changeRole({ userId: member.id, role: "admin" });
    expect((await getUserById(db, member.id))?.role).toBe("admin");
  });

  it("отозванное приглашение больше не открывается", async () => {
    const { id, token } = await caller(agencyId, owner).agency.invite({ email: "later@team.test" });
    await caller(agencyId, owner).agency.revokeInvite({ id });

    await expect(caller(agencyId, owner).agency.inviteInfo({ token })).rejects.toThrow();
    expect(await caller(agencyId, owner).agency.invites()).toHaveLength(0);
  });

  it("убранного участника возвращает новое приглашение на его адрес", async () => {
    // Раньше вернуть его было нельзя: регистрация упиралась в существующий
    // аккаунт, а вход — в отметку об удалении.
    await caller(agencyId, owner).agency.removeMember({ userId: member.id });
    const removed = (await getUserById(db, member.id))!;
    expect(await reactivateByInvitation(db, removed)).toBeUndefined();

    await caller(agencyId, owner).agency.invite({ email: removed.email });
    const invitation = await reactivateByInvitation(db, removed);

    expect(invitation?.agencyId).toBe(agencyId);
    expect((await getUserById(db, member.id))?.deactivatedAt).toBeNull();
  });
});

