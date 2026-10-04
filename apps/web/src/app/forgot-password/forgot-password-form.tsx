"use client";

import { useState } from "react";
import { authClient, settled } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-client-messages";
import { buttonClass } from "@/components/ui/button";
import { controlClass } from "@/components/ui/field";
import { cn } from "@/lib/utils";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const result = await settled(
      authClient.requestPasswordReset({
        email,
        redirectTo: "/reset-password",
      }),
    );

    setPending(false);

    if (result.error) {
      setError(authErrorMessage(result.error));
      return;
    }

    setDone(true);
  }

  if (done) {
    /**
     * Ответ одинаков и для существующего адреса, и для чужого: страница входа
     * не должна работать справочником «есть ли такой аккаунт».
     */
    return (
      <p data-testid="reset-requested" className="text-sm">
        If that email has an account, a link to set a new password is on its way. The link works
        for one hour.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">Work email</span>
        <input
          name="email"
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          autoComplete="email"
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
        className={buttonClass("primary", "lg", "w-full")}
      >
        {pending ? "Sending…" : "Send reset link"}
      </button>
    </form>
  );
}
