import { randomBytes } from "node:crypto";
import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { MemoryEmailSender } from "@repo/core";
import { createAgency, createDb, createInvitation, deleteAgency, getUserByEmail } from "@repo/db";
import { setEmailSender } from "@/server/email";

/**
 * Регистрация на занятый адрес и регистрация по приглашению.
 *
 * Режим `live` включается до того, как настройка входа прочтёт окружение:
 * только с подтверждением адреса регистрация отвечает на занятый адрес
 * так же, как на свободный. Письма ловятся в память — в сеть тест не ходит.
 */

vi.stubEnv("EMAIL_MODE", "live");
const mailbox = new MemoryEmailSender();
setEmailSender(mailbox);

const { auth, isInviteSignUp } = await import("@/lib/auth");
const { db, close } = createDb();
const createdAgencies: string[] = [];

afterEach(async () => {
  for (const id of createdAgencies.splice(0)) {
    await deleteAgency(db, id);
  }
  mailbox.clear();
});

afterAll(async () => {
  setEmailSender(null);
  vi.unstubAllEnvs();
  await close();
});

describe("регистрация на занятый адрес", () => {
  it("ответ тот же, а владельцу ящика уходит письмо со входом и сбросом пароля", async () => {
    const email = `taken-${crypto.randomUUID().slice(0, 8)}@agency.test`;
    await auth.api.signUpEmail({ body: { email, password: "correct-horse-battery", name: "A" } });
    const user = await getUserByEmail(db, email);
    if (user?.agencyId) createdAgencies.push(user.agencyId);
    mailbox.clear();

    const again = await auth.api.signUpEmail({
      body: { email, password: "another-password-1", name: "A" },
    });

    expect(again.token).toBeNull();
    const message = mailbox.lastTo(email);
    expect(message?.subject).toContain("already have");
    expect(message?.text).toContain("/login");
    expect(message?.text).toContain("/forgot-password");
  });
});

describe("лимит регистраций и приглашения", () => {
  function signUpRequest(body: Record<string, unknown>): Request {
    return new Request("http://localhost:3000/api/auth/sign-up/email", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("не считает регистрацию по живому приглашению на его адрес — и только её", async () => {
    const agencyId = (await createAgency(db, { name: "Office", clientLimit: 3 })).id;
    createdAgencies.push(agencyId);
    const token = randomBytes(24).toString("hex");
    await createInvitation(db, {
      agencyId,
      email: "fourth@office.test",
      role: "member",
      token,
      expiresAt: new Date(Date.now() + 86_400_000),
    });

    expect(
      await isInviteSignUp(signUpRequest({ email: "Fourth@office.test", inviteToken: token })),
    ).toBe(true);
    // Чужой адрес с живым токеном заводил бы своё агентство мимо лимита.
    expect(
      await isInviteSignUp(signUpRequest({ email: "someone@else.test", inviteToken: token })),
    ).toBe(false);
    expect(
      await isInviteSignUp(signUpRequest({ email: "fourth@office.test", inviteToken: "nope" })),
    ).toBe(false);
    expect(await isInviteSignUp(signUpRequest({ email: "fourth@office.test" }))).toBe(false);
  });
});
