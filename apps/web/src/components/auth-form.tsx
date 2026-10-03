"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { signIn, signUp } from "@/lib/auth-client";
import { buttonClass } from "@/components/ui/button";
import { controlClass } from "@/components/ui/field";
import { cn } from "@/lib/utils";

type Mode = "login" | "signup";

export function AuthForm({ mode, lockedEmail }: { mode: Mode; lockedEmail?: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
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

    // Куда вести после ссылки из письма: сервер впускает по ней сразу.
    const callbackURL = "/dashboard";
    const result =
      mode === "signup"
        ? await signUp.email({ email, password, name, callbackURL })
        : await signIn.email({ email, password, callbackURL });

    setPending(false);

    // Адрес не подтверждён: сервер уже отправил свежую ссылку. Сказать
    // «Email not verified» и оставить человека с этим — тупик.
    if (result.error?.code === "EMAIL_NOT_VERIFIED") {
      setResent(true);
      setAwaitingEmail(email);
      return;
    }

    if (result.error) {
      setError(result.error.message ?? "Something went wrong. Please try again.");
      return;
    }

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

    router.push("/dashboard");
    router.refresh();
  }

  if (awaitingEmail) {
    return (
      <div data-testid="verify-email-sent" className="flex flex-col gap-3">
        <h2 className="text-lg font-medium">Confirm your email</h2>
        <p className="text-sm text-muted-foreground">
          {resent ? "This address is not confirmed yet. We sent a fresh link to " : "We sent a link to "}
          <span className="font-medium">{awaitingEmail}</span>. Open it to finish setting up the
          account — the link signs you in.
        </p>
        <p className="text-sm text-muted-foreground">
          Nothing arrived? Check the spam folder, or sign in again with the same email and password —
          we will send a new link. Each link works for an hour.
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

      <button
        type="submit"
        disabled={pending}
        className={buttonClass("primary", "lg")}
      >
        {pending ? "Please wait…" : mode === "signup" ? "Create account" : "Sign in"}
      </button>
    </form>
  );
}
