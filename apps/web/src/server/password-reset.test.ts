import { afterAll, afterEach, describe, expect, it } from "vitest";
import { MemoryEmailSender } from "@repo/core";
import { createDb, deleteAgency, getUserByEmail } from "@repo/db";
import { auth } from "@/lib/auth";
import { setEmailSender } from "./email";

/**
 * Verify T85: сброс пароля работает целиком — от запроса до входа с новым
 * паролем. Без этого человек, забывший пароль, терял доступ к агентству:
 * почты в продукте не было вовсе.
 */

const { db, close } = createDb();
const mailbox = new MemoryEmailSender();

setEmailSender(mailbox);

afterAll(async () => {
  setEmailSender(null);
  await close();
});

const createdAgencies: string[] = [];

afterEach(async () => {
  for (const id of createdAgencies.splice(0)) {
    await deleteAgency(db, id);
  }
  mailbox.clear();
});

async function signUpFresh(): Promise<{ email: string; password: string }> {
  const email = `reset-${crypto.randomUUID().slice(0, 8)}@agency.test`;
  const password = "correct-horse-battery";

  await auth.api.signUpEmail({ body: { email, password, name: "Reset Tester", agencyName: "Test Agency" } as never });

  const user = await getUserByEmail(db, email);
  if (user) {
    createdAgencies.push(user.agencyId);
  }

  return { email, password };
}

/**
 * Ссылка в письме ведёт не на страницу, а на эндпоинт Better Auth:
 * `/api/auth/reset-password/<token>?callbackURL=/reset-password`. Он сам
 * перебросит человека на нашу страницу, добавив `?token=` (или `?error=`).
 */
function tokenFrom(text: string): string {
  const match = /reset-password\/([^?\s]+)/.exec(text);
  if (!match?.[1]) {
    throw new Error(`No reset token in the email:\n${text}`);
  }
  return match[1];
}

describe("password reset", () => {
  it("по ссылке из письма пароль меняется, и старый перестаёт работать", async () => {
    const { email, password } = await signUpFresh();

    await auth.api.requestPasswordReset({ body: { email, redirectTo: "/reset-password" } });

    const message = mailbox.lastTo(email);
    expect(message, "письмо о сбросе не собрано").toBeDefined();

    const newPassword = "a-completely-different-one";
    await auth.api.resetPassword({ body: { newPassword, token: tokenFrom(message!.text) } });

    await expect(
      auth.api.signInEmail({ body: { email, password: newPassword } }),
    ).resolves.toBeDefined();

    // Старый пароль после сброса не должен пускать: иначе сброс не сброс.
    await expect(auth.api.signInEmail({ body: { email, password } })).rejects.toThrow();
  });

  it("запрос на неизвестный адрес не выдаёт, есть ли такой аккаунт", async () => {
    await expect(
      auth.api.requestPasswordReset({
        body: { email: "nobody@nowhere.test", redirectTo: "/reset-password" },
      }),
    ).resolves.toBeDefined();

    expect(mailbox.sent).toHaveLength(0);
  });
});
