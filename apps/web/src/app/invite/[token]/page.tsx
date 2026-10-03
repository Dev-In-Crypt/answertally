import Link from "next/link";
import { getAgencyById, getInvitationByToken } from "@repo/db";
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
          It may have expired or already been used. Ask your teammate to send a new one.
        </p>
        <Link href="/login" className="text-sm font-medium text-primary hover:underline">
          Go to sign in
        </Link>
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
