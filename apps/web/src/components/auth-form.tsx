"use client";

import type { Route } from "next";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { settled, signIn, signUp } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-client-messages";
import { trackSignup } from "@/lib/tracking";
import { SUPPORT_EMAIL } from "@/config/site";
import { buttonClass } from "@/components/ui/button";
import { controlClass } from "@/components/ui/field";
import { cn } from "@/lib/utils";

type Mode = "login" | "signup";

export function AuthForm({
  mode,
  lockedEmail,
  inviteToken,
  next = "/dashboard",
}: {
  mode: Mode;
  lockedEmail?: string;
  /** Токен приглашения: без него регистрация заводит своё агентство. */
  inviteToken?: string;
  /** Куда вести после входа — уже проверенный `safeNextPath` путь. */
  next?: string;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [agencyName, setAgencyName] = useState("");
  const [email, setEmail] = useState(lockedEmail ?? "");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  /** Адрес, на который ушло письмо с подтверждением. Null — подтверждать не нужно. */
  const [awaitingEmail, setAwaitingEmail] = useState<string | null>(null);
  /** Письмо ушло повторно — при попытке войти с неподтверждённым адресом. */
  const [resent, setResent] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    /**
     * Куда вести после ссылки из письма: сервер впускает по ней сразу.
     *
     * Через страницу входа, а не прямо на панель: просроченная ссылка
     * возвращает сюда `?error=`, а панель без сессии отправляла на вход и
     * теряла его — человек видел голую форму без объяснений. Вошедшего
     * страница входа сама ведёт дальше.
     */
    const callbackURL =
      next === "/dashboard" ? "/login" : `/login?next=${encodeURIComponent(next)}`;
    const result =
      mode === "signup"
        ? await settled(
            signUp.email({
              email,
              password,
              name,
              callbackURL,
              ...(inviteToken ? { inviteToken } : { agencyName }),
            }),
          )
        : await settled(signIn.email({ email, password, callbackURL }));

    setPending(false);

    // Адрес не подтверждён: сервер уже отправил свежую ссылку. Сказать
    // «Email not verified» и оставить человека с этим — тупик.
    if (result.error?.code === "EMAIL_NOT_VERIFIED") {
      setResent(true);
      setAwaitingEmail(email);
      return;
    }

    if (result.error) {
      setError(authErrorMessage(result.error, mode === "signup" ? "signup" : "other"));
      return;
    }

    // Рекламная конверсия: считается по успешной регистрации, а не по нажатию.
    if (mode === "signup" && !inviteToken) trackSignup();

    /**
     * Пустая сессия после регистрации означает, что адрес ждёт подтверждения:
     * сервер завёл аккаунт, но входить не дал. Уводить такого человека на
     * панель нельзя — она отправит его обратно на вход, и он решит, что
     * регистрация не прошла.
     */
    if (mode === "signup" && !result.data?.token) {
      setAwaitingEmail(email);
      return;
    }

    router.push(next as Route);
    router.refresh();
  }

  if (awaitingEmail) {
    return (
      <div data-testid="verify-email-sent" className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Confirm your email</h2>
        <p className="text-sm text-muted-foreground">
          {resent
            ? "This address is not confirmed yet. We sent a fresh link to "
            : "We sent an email to "}
          <span className="font-medium">{awaitingEmail}</span>. Open the link in it to continue.
        </p>
        {/* Сервер не говорит, ушло ли письмо (и не должен: иначе регистрация
            выдавала бы, есть ли аккаунт), поэтому выход назван всегда. */}
        <p className="text-sm text-muted-foreground">
          Nothing arrived in a few minutes? Check the spam folder, or sign in again with the same
          email and password, and we will send a new link. Each link works for an hour. Still nothing?
          Write to {SUPPORT_EMAIL}.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      {mode === "signup" && (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Your name</span>
          <input
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            autoComplete="name"
            className={cn(controlClass, "h-10 px-3")}
          />
        </label>
      )}

      {/* По приглашению человек входит в чужое агентство — своего названия у
          него нет. */}
      {mode === "signup" && !inviteToken && (
        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Agency name</span>
          <input
            name="agency"
            value={agencyName}
            onChange={(e) => setAgencyName(e.target.value)}
            required
            maxLength={200}
            autoComplete="organization"
            className={cn(controlClass, "h-10 px-3")}
          />
          <span className="text-xs text-muted-foreground">
            Your clients see it at the top of every report. You can change it later, and add a
            logo, in Settings.
          </span>
        </label>
      )}

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Work email</span>
        <input
          name="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          readOnly={Boolean(lockedEmail)}
          autoComplete="email"
          className={cn(controlClass, "h-10 px-3")}
        />
      </label>

      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Password</span>
        <input
          name="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          autoComplete={mode === "signup" ? "new-password" : "current-password"}
          className={cn(controlClass, "h-10 px-3")}
        />
      </label>

      {error && (
        <p role="alert" data-testid="form-error" className="text-sm text-destructive">
          {error}
        </p>
      )}

      <button type="submit" disabled={pending} className={buttonClass("primary", "lg")}>
        {pending ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
      </button>
    </form>
  );
}
