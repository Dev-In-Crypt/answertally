import Link from "next/link";
import { getAgencyById, getInvitationByToken, getUserByEmail } from "@repo/db";
import { AuthForm } from "@/components/auth-form";
import { db } from "@/server/db";

export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;

  let agencyName: string | null = null;
  let email: string | null = null;
  const invitation = await getInvitationByToken(db, token);
  const valid = invitation && !invitation.accepted && invitation.expiresAt.getTime() >= Date.now();

  if (valid) {
    email = invitation.email;
    agencyName = (await getAgencyById(db, invitation.agencyId))?.name ?? null;
  }

  if (!email) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-4 px-6">
        <h1 className="text-xl font-semibold tracking-tight">This invitation is no longer valid</h1>
        <p className="text-sm text-muted-foreground">
          If you already accepted it, sign in — a missing confirmation email is sent again when you
          do. If it expired, ask your teammate to send a new one.
        </p>
        <Link href="/login" className="text-sm font-medium text-primary hover:underline">
          Go to sign in
        </Link>
      </main>
    );
  }

  // Аккаунт на этот адрес уже есть — регистрация не пройдёт. Убранный из
  // агентства участник возвращается входом: приглашение принимается при нём.
  const existing = await getUserByEmail(db, email.toLowerCase());
  if (existing) {
    return (
      <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-6 px-6">
        <div className="flex flex-col gap-1.5">
          <h1 className="text-xl font-semibold tracking-tight">Join {agencyName ?? "your team"}</h1>
          <p className="text-sm text-muted-foreground">
            {existing.deactivatedAt
              ? "Sign in with your existing password to rejoin the workspace."
              : "This email already has an account, and an account belongs to one workspace. Ask your teammate to invite a different address."}
          </p>
        </div>
        {existing.deactivatedAt && <AuthForm mode="login" lockedEmail={email} />}
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-sm flex-col justify-center gap-6 px-6">
      <div className="flex flex-col gap-1.5">
        <h1 className="text-xl font-semibold tracking-tight">Join {agencyName ?? "your team"}</h1>
        <p className="text-sm text-muted-foreground">
          Create your account for <span className="font-medium text-foreground">{email}</span> to
          join the workspace.
        </p>
      </div>

      <AuthForm mode="signup" lockedEmail={email} inviteToken={token} />
    </main>
  );
}
