"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { authClient, settled } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-client-messages";
import { buttonClass } from "@/components/ui/button";
import { controlClass } from "@/components/ui/field";
import { cn } from "@/lib/utils";

export function ResetPasswordForm({ token }: { token: string }) {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Ссылка просрочена или уже использована — нужен путь к новой. */
  const [linkDead, setLinkDead] = useState(false);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);

    const result = await settled(authClient.resetPassword({ newPassword: password, token }));

    setPending(false);

    if (result.error) {
      setError(authErrorMessage(result.error));
      setLinkDead(result.error.code === "INVALID_TOKEN" || result.error.code === "TOKEN_EXPIRED");
      return;
    }

    router.push("/login?reset=done");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-4">
      <label className="flex flex-col gap-1.5">
        <span className="text-sm font-medium">New password</span>
        <input
          name="password"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          autoComplete="new-password"
          className={cn(controlClass, "h-10 px-3")}
        />
      </label>

      {error && (
        <p role="alert" data-testid="form-error" className="text-sm text-destructive">
          {error}{" "}
          {linkDead && (
            <Link href="/forgot-password" className="font-medium underline underline-offset-4">
              Request a new link
            </Link>
          )}
        </p>
      )}

      <button
        type="submit"
        disabled={pending}
        className={buttonClass("primary", "lg", "w-full")}
      >
        {pending ? "Saving…" : "Save new password"}
      </button>
    </form>
  );
}
