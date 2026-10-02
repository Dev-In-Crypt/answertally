import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { passwordResetEmail, verifyEmailEmail } from "@repo/core";
import { requiresEmailVerification } from "@/lib/email-verification";
import {
  accounts,
  agencies,
  createDb,
  getPendingInvitationByEmail,
  markInvitationAccepted,
  sessions,
  users,
  verifications,
} from "@repo/db";
import { getEmailSender } from "@/server/email";

const { db } = createDb();

/** Имя агентства по умолчанию выводим из домена почты: owner@acme-agency.com -> "Acme Agency". */
export function deriveAgencyName(email: string): string {
  const domain = email.split("@")[1] ?? "";
  const label = domain.split(".")[0] ?? "";
  const words = label
    .split(/[-_]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1));
  return words.length > 0 ? words.join(" ") : "My Agency";
}

/**
 * Сколько аккаунтов можно завести с одного адреса.
 *
 * Своё умолчание у Better Auth — 3 регистрации за 10 секунд. Это защита от
 * случайного двойного клика, а не от злоупотребления: получается больше
 * тысячи аккаунтов в час с одного адреса.
 *
 * А каждый аккаунт стоит денег. Бесплатный аудит даёт 250 живых проверок,
 * подтверждения почты нет, и аккаунт заводится на любой адрес — то есть это
 * единственный наш расход без верхней границы. Час на окно превращает
 * тысячу аккаунтов в три.
 *
 * Не непроходимая стена: адрес меняется. Но она переводит злоупотребление
 * из «скрипт на минуту» в «нужен список прокси», а вместе с удалением Grok
 * из бесплатного аудита снижает цену одной попытки с $8.55 до $0.94.
 *
 * Счётчики живут в памяти процесса — этого хватает, пока веб один. Второму
 * инстансу понадобится общее хранилище (`rateLimit.customStorage`), и
 * Redis для этого в приложении уже есть (`server/redis.ts`).
 */
export const SIGNUP_RATE_LIMIT = { window: 3600, max: 3 } as const;

export const auth = betterAuth({
  secret: process.env.BETTER_AUTH_SECRET,
  baseURL: process.env.BETTER_AUTH_URL ?? "http://localhost:3000",
  database: drizzleAdapter(db, {
    provider: "pg",
    // Ключи должны совпадать с modelName ниже, а не с дефолтными именами моделей
    // Better Auth (user/session/...) — адаптер ищет таблицу именно по modelName.
    schema: { users, sessions, accounts, verifications },
  }),
  emailAndPassword: {
    enabled: true,
    /**
     * До подтверждения адреса аккаунт не входит.
     *
     * Это единственное место, где мы платим за человека, ничего о нём не
     * зная: бесплатный аудит — живые вызовы, а аккаунт заводится на любую
     * строку с собакой. Непроходимой стеной подтверждение не будет —
     * одноразовые ящики существуют, — но превращает «скрипт на минуту» в
     * ручную работу.
     */
    requireEmailVerification: requiresEmailVerification(),
    /**
     * Сброс пароля обязателен даже без почтового транспорта: без него человек,
     * забывший пароль, теряет доступ к агентству навсегда. В режиме без ключа
     * ссылка уходит в лог — восстановить доступ всё равно можно.
     */
    sendResetPassword: async ({ user, url }) => {
      await getEmailSender().send(passwordResetEmail({ to: user.email, resetUrl: url }));
    },
  },
  emailVerification: {
    /**
     * Письмо уходит при регистрации само. Отдельного выключателя нет: по
     * умолчанию Better Auth шлёт его ровно тогда, когда подтверждение
     * требуется, и разводить эти два решения значило бы завести состояние
     * «требуем, но не отправляем».
     */
    sendVerificationEmail: async ({ user, url }) => {
      await getEmailSender().send(verifyEmailEmail({ to: user.email, verifyUrl: url }));
    },
  },
  user: {
    modelName: "users",
    additionalFields: {
      // input: false — клиент не может подставить чужой agencyId при регистрации.
      agencyId: { type: "string", required: false, input: false },
      role: { type: "string", required: false, input: false, defaultValue: "member" },
    },
  },
  session: { modelName: "sessions" },
  account: { modelName: "accounts" },
  verification: { modelName: "verifications" },
  advanced: {
    // id генерирует Postgres (uuid), а не Better Auth.
    database: { generateId: false },
  },
  // В проде лимит нужен, но e2e делает несколько регистраций подряд с одного адреса
  // и упирается в него — там он отключается явным флагом окружения.
  rateLimit: {
    enabled: process.env.DISABLE_RATE_LIMIT !== "true",
    customRules: { "/sign-up/*": SIGNUP_RATE_LIMIT },
  },
  databaseHooks: {
    user: {
      create: {
        /**
         * Регистрация по приглашению присоединяет к существующему агентству;
         * обычная регистрация создаёт новое, и пользователь становится его owner'ом
         * (инвариант 1 из CLAUDE.md: у каждого пользователя есть agency_id).
         */
        before: async (user) => {
          const email = user.email;

          const invitation = await getPendingInvitationByEmail(db, email);
          if (invitation) {
            await markInvitationAccepted(db, invitation.token);
            return { data: { ...user, agencyId: invitation.agencyId, role: invitation.role } };
          }

          const [agency] = await db
            .insert(agencies)
            .values({ name: deriveAgencyName(email) })
            .returning({ id: agencies.id });

          if (!agency) {
            throw new Error("Failed to create agency during signup");
          }

          return { data: { ...user, agencyId: agency.id, role: "owner" } };
        },
      },
    },
  },
});
