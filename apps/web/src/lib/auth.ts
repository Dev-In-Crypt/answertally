import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { APIError, createAuthMiddleware, isAPIError } from "better-auth/api";
import {
  canonicalEmail,
  EMAIL_COPY,
  isDisposableEmail,
  passwordResetEmail,
  verifyEmailEmail,
  type EmailMessage,
} from "@repo/core";
import { requiresEmailVerification } from "@/lib/email-verification";
import {
  accounts,
  agencies,
  claimInvitation,
  findUserByCanonicalEmail,
  getInvitationByToken,
  getUserById,
  reactivateByInvitation,
  sessions,
  users,
  verifications,
} from "@repo/db";
import { db } from "@/server/db";
import { appUrl, getEmailSender } from "@/server/email";
import { hit } from "@/server/rate-limit";


/** Токен приглашения из тела регистрации — его шлёт форма на `/invite/[token]`. */
function inviteTokenFrom(body: unknown): string | null {
  const token = (body as { inviteToken?: unknown } | undefined)?.inviteToken;
  return typeof token === "string" && token.length > 0 ? token : null;
}

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
 * А каждый аккаунт стоит денег: бесплатный аудит — живые проверки. Час на
 * окно превращает тысячу аккаунтов в три.
 *
 * Не непроходимая стена: адрес меняется. Но она переводит злоупотребление
 * из «скрипт на минуту» в «нужен список прокси», а вместе с удалением Grok
 * из бесплатного аудита снижает цену одной попытки с $8.55 до $0.94.
 *
 * Счётчики — в Redis (`rateLimit.customStorage` ниже), а не в памяти: та
 * обнулялась каждым деплоем.
 */
export const SIGNUP_RATE_LIMIT = { window: 3600, max: 3 } as const;

/**
 * Писем подтверждения и сброса — не больше десяти каждого вида в сутки на адрес.
 *
 * Лимит по IP их не держит: зарегистрировав чужой адрес и меняя адреса,
 * можно было слать жертве письма от нашего домена без конца — и жечь его
 * репутацию. Сверх лимита письмо молча не уходит: ответ тот же, чтобы не
 * подсказывать, сработал ли лимит.
 */
export const AUTH_EMAILS_PER_ADDRESS_PER_DAY = 10;

async function mayMailAddress(
  kind: "reset" | "verify" | "exists",
  email: string,
): Promise<boolean> {
  // Счётчики раздельные: иначе пять чужих запросов сброса закрывали бы
  // человеку и письмо подтверждения.
  return hit(`auth-mail:${kind}:${email.toLowerCase()}`, AUTH_EMAILS_PER_ADDRESS_PER_DAY, 24 * 60 * 60);
}

/** Сколько регистрация и вход ждут почту, прежде чем ответить человеку. */
const AUTH_EMAIL_WAIT_MS = 5000;

/**
 * Отправить письмо входа, но не держать форму дольше нескольких секунд.
 *
 * Транспорт повторяет попытки (до трёх по 15 секунд), и при сбое Resend
 * кнопка «Create account» висела почти минуту. Теперь форма ждёт не дольше
 * нескольких секунд; отправка доживает своё в фоне, отказ уходит в журнал.
 *
 * `true` — транспорт отказал, пока форма ещё ждала. Поздний отказ остаётся
 * только в журнале: ответ к тому времени уже ушёл.
 */
async function sendAuthEmail(message: EmailMessage): Promise<boolean> {
  let failed = false;
  const sending = getEmailSender()
    .send(message)
    .then(
      () => undefined,
      (error: unknown) => {
        failed = true;
        console.error("[auth] email delivery failed", error);
      },
    );
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    sending,
    new Promise<void>((resolve) => {
      timer = setTimeout(resolve, AUTH_EMAIL_WAIT_MS);
    }),
  ]);
  clearTimeout(timer);
  return failed;
}

/**
 * Адреса, письмо подтверждения на которые не ушло, — для ответа формы.
 *
 * Better Auth глотает ошибку отправки, и форма после отказа Resend говорила
 * «We sent an email»: человек ждал письма, которого нет. Отказ запоминается
 * здесь, а хук `after` ниже подменяет ответ регистрации и входа фразой с
 * выходом. Регистрация на занятый адрес тоже шлёт письмо (`existing`), и
 * его отказ даёт тот же ответ — по нему не узнать, есть ли аккаунт.
 *
 * Сброс пароля сюда не пишет: он отвечает одинаково для любого адреса, и
 * отказ письма выдал бы, что аккаунт есть. Его форма и так говорит
 * «если аккаунт есть», а отказ остаётся в журнале.
 *
 * Режим без почты (EMAIL_MODE=log) отказом не считается: ссылка в журнале
 * сервера, и тот, кто так поднял продукт, берёт её оттуда.
 */
const unsentVerification = new Map<string, number>();
const UNSENT_TTL_MS = 60_000;

async function sendVerificationLike(message: EmailMessage): Promise<void> {
  if (await sendAuthEmail(message)) unsentVerification.set(message.to.toLowerCase(), Date.now());
}

/** Забрать отметку об отказе: одна отметка — один ответ. */
function takeUnsentVerification(email: string): boolean {
  const at = unsentVerification.get(email);
  unsentVerification.delete(email);
  return at !== undefined && Date.now() - at < UNSENT_TTL_MS;
}

export const VERIFICATION_EMAIL_NOT_SENT =
  "We could not send the confirmation email just now. Wait a minute, then sign in with the same email and password and we will send a new link.";

/**
 * Письмо тому, на чей адрес пытаются завести второй аккаунт.
 *
 * Регистрация на занятый адрес отвечает так же, как на свободный — иначе
 * форма выдавала бы, у кого есть аккаунт. Но без письма человек, забывший,
 * что уже регистрировался, ждал ссылку, которая не придёт, и пароль,
 * придуманный заново, не подходил. Письмо называет оба выхода.
 */
function existingAccountEmail(to: string): EmailMessage {
  const base = appUrl();
  const lines = [
    `Someone tried to create a new ${EMAIL_COPY.productName} account with this address, but it already has one.`,
    `Sign in: ${base}/login`,
    `Forgot the password? Set a new one: ${base}/forgot-password`,
    "If it was not you, ignore this email — nothing changed in your account.",
  ];
  return {
    to,
    subject: `You already have an ${EMAIL_COPY.productName} account`,
    text: lines.join("\n\n"),
    html: [
      `<p>${lines[0]}</p>`,
      `<p><a href="${base}/login">Sign in</a></p>`,
      `<p>Forgot the password? <a href="${base}/forgot-password">Set a new one</a></p>`,
      `<p>${lines[3]}</p>`,
    ].join("\n"),
  };
}

/**
 * Регистрация по живому приглашению на тот адрес, которому оно выписано.
 *
 * Такую регистрацию лимит по IP не считает: команда агентства принимает
 * приглашения из одного офиса, за одним адресом, и четвёртый сотрудник
 * упирался в «слишком много попыток» на час. Обойти лимит этим нельзя:
 * приглашение одноразовое, адрес в нём задан, а сами приглашения
 * ограничены квотой агентства.
 */
export async function isInviteSignUp(request: Request): Promise<boolean> {
  try {
    const body = (await request.clone().json()) as { email?: unknown };
    const token = inviteTokenFrom(body);
    if (!token || typeof body.email !== "string") return false;
    const invitation = await getInvitationByToken(db, token);
    return Boolean(
      invitation &&
      !invitation.accepted &&
      invitation.expiresAt.getTime() > Date.now() &&
      invitation.email.toLowerCase() === body.email.trim().toLowerCase(),
    );
  } catch {
    return false;
  }
}

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
      if (!(await mayMailAddress("reset", user.email))) return;
      // Без отметки об отказе — см. `unsentVerification`.
      await sendAuthEmail(passwordResetEmail({ to: user.email, resetUrl: url }));
    },
    // Ответ формы остаётся тем же, что и для нового адреса; письмо — только
    // владельцу ящика.
    onExistingUserSignUp: async ({ user }) => {
      if (!(await mayMailAddress("exists", user.email))) return;
      await sendVerificationLike(existingAccountEmail(user.email));
    },
    // Сброс пароля выкидывает все остальные входы: иначе укравший сессию
    // оставался внутри и после того, как владелец сменил пароль.
    revokeSessionsOnPasswordReset: true,
  },
  emailVerification: {
    /**
     * Потерявший письмо получает новое, просто войдя со своим паролем.
     *
     * Без этого он застревал навсегда: повторная регистрация на тот же адрес
     * письма заново не шлёт, а ссылка живёт час. Пароль проверяется до
     * отправки, так что чужой ящик этим не завалить.
     */
    sendOnSignIn: true,
    // Ссылка из письма доказывает доступ к ящику — после неё человек сразу
    // внутри, а не на главной странице с вопросом «и что теперь».
    autoSignInAfterVerification: true,
    /**
     * Письмо уходит при регистрации само. Отдельного выключателя нет: по
     * умолчанию Better Auth шлёт его ровно тогда, когда подтверждение
     * требуется, и разводить эти два решения значило бы завести состояние
     * «требуем, но не отправляем».
     */
    sendVerificationEmail: async ({ user, url }) => {
      if (!(await mayMailAddress("verify", user.email))) return;
      await sendVerificationLike(verifyEmailEmail({ to: user.email, verifyUrl: url }));
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
    customRules: {
      "/sign-up/*": async (request) =>
        (await isInviteSignUp(request)) ? false : SIGNUP_RATE_LIMIT,
    },
    /**
     * Счёт — в Redis через общий счётчик, а не в памяти процесса: память
     * обнулялась каждым деплоем, и лимит регистраций сбрасывался вместе с
     * ним. Без Redis счётчик сам уходит в память.
     */
    customStorage: {
      consume: async (key, rule) => {
        const allowed = await hit(`auth:${key}`, rule.max, rule.window);
        return { allowed, retryAfter: allowed ? null : rule.window };
      },
      // При `consume` Better Auth старым путём get/set не ходит.
      get: async () => null,
      set: async () => {},
    },
  },
  hooks: {
    /**
     * Письмо подтверждения не ушло — регистрация и вход говорят это прямо,
     * а не «We sent an email». Аккаунт при этом уже заведён: вход с тем же
     * паролем пришлёт новую ссылку (`sendOnSignIn`).
     */
    after: createAuthMiddleware(async (ctx) => {
      const signIn = ctx.path === "/sign-in/email";
      if (!signIn && ctx.path !== "/sign-up/email") return;
      // Подменяется только ответ «письмо отправлено»: у входа это отказ
      // EMAIL_NOT_VERIFIED, у регистрации — успех. Иначе отметка, оставленная
      // другим запросом на тот же адрес, сорвала бы удачный вход — уже с
      // выставленной cookie сессии.
      const returned = ctx.context.returned;
      const sentReply = signIn
        ? isAPIError(returned) && returned.body?.code === "EMAIL_NOT_VERIFIED"
        : !isAPIError(returned);
      if (!sentReply) return;
      const email: unknown = ctx.body?.email;
      if (typeof email !== "string" || !takeUnsentVerification(email.toLowerCase())) return;
      throw new APIError("UNPROCESSABLE_ENTITY", {
        message: VERIFICATION_EMAIL_NOT_SENT,
        code: "VERIFICATION_EMAIL_NOT_SENT",
      });
    }),
  },
  databaseHooks: {
    session: {
      create: {
        // Убранный из агентства участник больше не входит: его сессии
        // отозваны при удалении, а новую он не получит.
        before: async (session) => {
          const user = await getUserById(db, session.userId);
          // Новое приглашение на его адрес возвращает участника при входе.
          if (user?.deactivatedAt && !(await reactivateByInvitation(db, user))) {
            throw new APIError("FORBIDDEN", {
              message:
                "This account was removed from its workspace. Ask the owner to invite you again, then sign in.",
            });
          }
        },
      },
    },
    user: {
      create: {
        /**
         * Регистрация по приглашению присоединяет к существующему агентству;
         * обычная регистрация создаёт новое, и пользователь становится его owner'ом
         * (инвариант 1 из CLAUDE.md: у каждого пользователя есть agency_id).
         */
        before: async (user, context) => {
          const email = user.email;

          // Один ящик — один аккаунт: a.b@gmail, ab+1@gmail и ab@googlemail
          // попадают в один ящик, и каждый вариант давал новый бесплатный аудит.
          if (await findUserByCanonicalEmail(db, canonicalEmail(email))) {
            throw new APIError("BAD_REQUEST", {
              message: "An account for this inbox already exists. Sign in instead.",
            });
          }

          // Только по токену из ссылки приглашения: совпадение почты само по
          // себе ничего не доказывает (см. `claimInvitation`).
          const inviteToken = inviteTokenFrom(context?.body);
          const invitation = inviteToken ? await claimInvitation(db, inviteToken, email) : undefined;
          if (invitation) {
            return { data: { ...user, agencyId: invitation.agencyId, role: invitation.role } };
          }

          // Своё агентство — это бесплатный аудит. Одноразовый ящик живёт
          // десять минут и нужен ровно для того, чтобы получить его ещё раз.
          if (isDisposableEmail(email)) {
            throw new APIError("BAD_REQUEST", {
              message: "Use a work or personal email that you keep. Temporary inboxes are not accepted.",
            });
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
