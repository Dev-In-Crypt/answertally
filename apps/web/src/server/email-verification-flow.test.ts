import { afterAll, afterEach, describe, expect, it, vi } from "vitest";
import { MemoryEmailSender } from "@repo/core";
import { createDb, deleteAgency, getUserByEmail } from "@repo/db";
import { setEmailSender } from "./email";

/**
 * Подтверждение адреса работает целиком: регистрация, потерянное письмо,
 * повторная отправка, ссылка, вход.
 *
 * Требуется оно только при настоящей почте, поэтому здесь режим `live`
 * включается до того, как настройка входа прочтёт окружение, а письма
 * ловятся в память — в сеть тест не ходит. Отправитель подменён раньше
 * первого письма, так что транспорт Resend не создаётся вовсе.
 */

vi.stubEnv("EMAIL_MODE", "live");
const mailbox = new MemoryEmailSender();
setEmailSender(mailbox);

const { auth } = await import("@/lib/auth");
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

/** Токен из ссылки `/api/auth/verify-email?token=…` в последнем письме. */
function lastVerifyToken(): string {
  const message = mailbox.sent.at(-1);
  const match = message ? /verify-email\?token=([^&\s]+)/.exec(message.text) : null;
  if (!match?.[1]) {
    throw new Error(`No verification link in the last email:\n${message?.text ?? "(none)"}`);
  }
  return match[1];
}

async function signUpFresh() {
  const email = `verify-${crypto.randomUUID().slice(0, 8)}@agency.test`;
  const password = "correct-horse-battery";
  const result = await auth.api.signUpEmail({ body: { email, password, name: "Verify Tester" } });

  const user = await getUserByEmail(db, email);
  if (user?.agencyId) {
    createdAgencies.push(user.agencyId);
  }
  return { email, password, result };
}

describe("подтверждение адреса при регистрации", () => {
  it("регистрация не впускает, а шлёт письмо со ссылкой", async () => {
    const { email, result } = await signUpFresh();

    // Пустая сессия — по ней форма понимает, что надо ждать письма.
    expect(result.token).toBeNull();
    expect(mailbox.sent).toHaveLength(1);
    expect(mailbox.sent[0]?.to).toBe(email);
    expect((await getUserByEmail(db, email))?.emailVerified).toBe(false);
  });

  it("потерявший письмо получает новое, войдя со своим паролем", async () => {
    /**
     * Без этого он застревал навсегда: повторная регистрация на тот же адрес
     * письма заново не шлёт, а ссылка живёт час.
     */
    const { email, password } = await signUpFresh();
    mailbox.clear();

    await expect(auth.api.signInEmail({ body: { email, password } })).rejects.toMatchObject({
      body: { code: "EMAIL_NOT_VERIFIED" },
    });
    expect(mailbox.sent).toHaveLength(1);
    expect(mailbox.sent[0]?.to).toBe(email);
  });

  it("с неверным паролем свежего письма нет", async () => {
    // Иначе любой мог бы засыпать чужой ящик письмами от нашего имени.
    const { email } = await signUpFresh();
    mailbox.clear();

    await expect(
      auth.api.signInEmail({ body: { email, password: "wrong-password-entirely" } }),
    ).rejects.toBeDefined();
    expect(mailbox.sent).toHaveLength(0);
  });

  it("ссылка подтверждает адрес, и после неё вход работает", async () => {
    const { email, password } = await signUpFresh();

    await auth.api.verifyEmail({ query: { token: lastVerifyToken() }, asResponse: true });

    expect((await getUserByEmail(db, email))?.emailVerified).toBe(true);
    const signedIn = await auth.api.signInEmail({ body: { email, password } });
    expect(signedIn.token).toBeTruthy();
  });
});
