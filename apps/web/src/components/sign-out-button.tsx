"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { settled, signOut } from "@/lib/auth-client";
import { authErrorMessage } from "@/lib/auth-client-messages";
import { buttonClass } from "@/components/ui/button";

export function SignOutButton() {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <span className="flex items-center gap-2">
      <button
        type="button"
        disabled={pending}
        onClick={async () => {
          setError(null);
          setPending(true);
          const result = await settled(signOut());
          setPending(false);
          // Сессия жива — страница входа вернула бы обратно, и клик выглядел
          // бы ничем. Лучше сказать, что выход не прошёл.
          if (result.error) {
            setError(authErrorMessage(result.error));
            return;
          }
          router.push("/login");
          router.refresh();
        }}
        className={buttonClass("outline", "md")}
      >
        {pending ? "Signing out…" : "Sign out"}
      </button>
      {error && (
        <span role="alert" className="order-first max-w-56 text-xs text-destructive">
          {error}
        </span>
      )}
    </span>
  );
}
