import Link from "next/link";
import { ResetPasswordForm } from "./reset-password-form";
import { buttonClass } from "@/components/ui/button";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string; error?: string }>;
}) {
  const { token, error } = await searchParams;

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-6 px-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-xl font-semibold tracking-tight">Set a new password</h1>
        {/* Просроченная ссылка не должна выглядеть поломкой продукта. */}
        <p className="text-sm text-muted-foreground">
          {token && !error
            ? "Choose a password you do not use anywhere else."
            : "This link is no longer valid. Ask for a new one; it takes a moment."}
        </p>
      </div>

      {token && !error ? (
        <ResetPasswordForm token={token} />
      ) : (
        <Link
          href="/forgot-password"
          className={buttonClass("primary", "lg", "w-full")}
        >
          Request a new link
        </Link>
      )}

      <p className="text-sm text-muted-foreground">
        <Link href="/login" className="font-medium text-primary underline-offset-4 hover:underline">
          Back to sign in
        </Link>
      </p>
    </main>
  );
}
