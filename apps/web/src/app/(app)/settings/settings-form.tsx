"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { validateLogoUpload } from "@repo/core/storage/types";
import { api } from "@/trpc/react";
import { buttonClass } from "@/components/ui/button";
import { controlClass } from "@/components/ui/field";
import { FileInput } from "@/components/ui/file-input";
import { cn } from "@/lib/utils";

export function SettingsForm({
  initialName,
  initialColor,
  initialLogoUrl,
  canManage,
}: {
  initialName: string;
  initialColor: string;
  initialLogoUrl: string | null;
  /**
   * Админ или владелец. Участнику поля показываются только для чтения:
   * раньше он правил их, жал «Save» и получал отказ сервера.
   */
  canManage: boolean;
}) {
  const router = useRouter();

  const [name, setName] = useState(initialName);
  const [brandColor, setBrandColor] = useState(initialColor);
  const [logoUrl, setLogoUrl] = useState(initialLogoUrl);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // Прежнее «Saved» рядом с новой ошибкой читалось как успех.
  function fail(message: string) {
    setStatus(null);
    setError(message);
  }

  const update = api.agency.update.useMutation({
    onSuccess: () => {
      setStatus("Saved");
      setError(null);
      router.refresh();
    },
    onError: (e) => fail(e.message),
  });

  async function handleLogoChange(file: File | null) {
    if (!file) return;

    setError(null);
    setStatus(null);
    // Проверка до отправки: файл больше 10 МБ прокси обрывает пустым 413,
    // и до сервера с его понятным текстом дело не доходит.
    const validation = validateLogoUpload(file.type, file.size);
    if (!validation.ok) {
      fail(validation.error ?? "Use a PNG, JPEG, WebP or SVG image under 2 MB.");
      return;
    }

    const body = new FormData();
    body.append("file", file);

    setUploading(true);
    try {
      const response = await fetch("/api/upload/logo", { method: "POST", body });
      // Ответ не обязательно JSON: прокси и упавший сервер отвечают HTML или
      // пустым телом, и разбор бросал исключение, которое никто не видел.
      const payload = (await response.json().catch(() => ({}))) as {
        url?: string;
        error?: string;
      };

      if (!response.ok || !payload.url) {
        fail(
          payload.error ??
            (response.status === 413
              ? "Keep the logo under 2 MB."
              : "The logo did not upload. Try again in a minute."),
        );
        return;
      }

      setLogoUrl(`${payload.url}?v=${Date.now()}`);
      setStatus("Logo updated");
      router.refresh();
    } catch {
      fail("Can't reach Answertally. Check your connection and try again.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex max-w-xl flex-col gap-8">
      <section className="flex flex-col gap-4">
        <h2 className="text-base font-medium">Agency profile</h2>

        <label className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Agency name</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            readOnly={!canManage}
            required
            maxLength={200}
            className={cn(controlClass, "h-10 px-3")}
          />
        </label>

        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">Brand colour</span>
          <p className="text-sm text-muted-foreground">
            Used on client-facing reports instead of any product branding.
          </p>
          <div className="flex items-center gap-3">
            <input
              aria-label="Brand colour"
              type="color"
              value={brandColor}
              onChange={(e) => setBrandColor(e.target.value)}
              disabled={!canManage}
              className="h-10 w-16 cursor-pointer rounded-md border border-input bg-background"
            />
            <code data-testid="brand-color-value" className="text-sm text-muted-foreground">
              {brandColor}
            </code>
          </div>
        </div>

        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium">Logo</span>
          {logoUrl ? (
            // Обычный img, а не next/image: файл пользовательский и отдаётся своим хранилищем.
            <img
              data-testid="agency-logo"
              src={logoUrl}
              alt="Agency logo"
              className="h-12 w-auto rounded border bg-background object-contain p-1"
            />
          ) : (
            <p className="text-sm text-muted-foreground">No logo uploaded yet.</p>
          )}
          {canManage && (
            <FileInput
              label="Logo file"
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
              onSelect={(file) => void handleLogoChange(file)}
              disabled={uploading}
              buttonText={uploading ? "Uploading…" : "Choose file"}
              hint="PNG, JPEG, WebP or SVG, under 2 MB."
              testId="logo-file"
            />
          )}
        </div>

        {canManage ? (
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => {
                // Пустое имя сервер отклонил бы техническим текстом.
                if (!name.trim()) {
                  fail("Enter the agency name.");
                  return;
                }
                setStatus(null);
                update.mutate({ name: name.trim(), brandColor });
              }}
              disabled={update.isPending || uploading}
              className={buttonClass("primary", "lg")}
            >
              {update.isPending ? "Saving…" : "Save changes"}
            </button>
            {status && (
              <span data-testid="settings-status" className="text-sm text-muted-foreground">
                {status}
              </span>
            )}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Only admins and the owner can change branding and invite teammates.
          </p>
        )}

        {error && (
          <p role="alert" data-testid="form-error" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </section>

      <TeamSection canManage={canManage} />
    </div>
  );
}

function TeamSection({ canManage }: { canManage: boolean }) {
  const members = api.agency.members.useQuery();
  const invites = api.agency.invites.useQuery();
  const [email, setEmail] = useState("");
  const [invited, setInvited] = useState<{ link: string; delivered: boolean } | null>(null);
  /**
   * Ошибка последнего действия со списком. Раньше бралась первая из трёх
   * мутаций, и старый отказ висел и после успешного действия.
   */
  const [teamError, setTeamError] = useState<string | null>(null);

  /**
   * Список перечитывается и после отказа: чаще всего отказ значит, что его
   * уже поменял кто-то другой, и старая строка звала бы повторить то же.
   */
  const teamAction = {
    onMutate: () => setTeamError(null),
    onError: (e: { message: string }) => setTeamError(e.message),
    onSettled: () => {
      void members.refetch();
      void invites.refetch();
    },
  };

  const invite = api.agency.invite.useMutation({
    onMutate: () => setInvited(null),
    onSuccess: (data) => {
      setInvited({ link: data.inviteUrl, delivered: data.delivered });
      setEmail("");
      void invites.refetch();
    },
  });
  // Ушедший сотрудник не должен сохранять доступ к клиентам агентства.
  const removeMember = api.agency.removeMember.useMutation(teamAction);
  const changeRole = api.agency.changeRole.useMutation(teamAction);
  const revokeInvite = api.agency.revokeInvite.useMutation(teamAction);
  const myRole = members.data?.find((member) => member.isYou)?.role;

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-base font-medium">Team</h2>

      <ul className="flex flex-col gap-1 text-sm">
        {members.data?.map((member) => (
          <li
            key={member.id}
            data-testid="team-member"
            className="flex items-center justify-between gap-3 rounded-md border px-3 py-2"
          >
            <span>{member.email}</span>
            <span className="flex items-center gap-2">
              {myRole === "owner" && !member.isYou && member.role !== "owner" ? (
                <select
                  aria-label={`Role of ${member.email}`}
                  value={member.role}
                  onChange={(e) =>
                    changeRole.mutate({
                      userId: member.id,
                      role: e.target.value as "admin" | "member",
                    })
                  }
                  className={cn(controlClass, "h-8 px-2")}
                >
                  <option value="admin">admin</option>
                  <option value="member">member</option>
                </select>
              ) : (
                <span className="text-muted-foreground">{member.role}</span>
              )}
              {/* Администратора убирает только владелец — кнопку видит только он. */}
              {myRole !== "member" &&
                !member.isYou &&
                member.role !== "owner" &&
                (member.role !== "admin" || myRole === "owner") && (
                  <button
                    type="button"
                    onClick={() => {
                      // Без подтверждения один промах закрывал человеку доступ.
                      if (window.confirm(`Remove ${member.email} from the workspace?`)) {
                        removeMember.mutate({ userId: member.id });
                      }
                    }}
                    disabled={removeMember.isPending}
                    className={buttonClass("outline", "sm")}
                  >
                    Remove
                  </button>
                )}
            </span>
          </li>
        ))}
      </ul>

      {/* Без строки пустой список читался как «в команде никого». */}
      {(members.error || invites.error) && (
        <p role="alert" className="text-sm text-destructive">
          The team list did not load. Reload the page to try again.
        </p>
      )}

      {teamError && (
        <p role="alert" data-testid="team-error" className="text-sm text-destructive">
          {teamError}
        </p>
      )}

      {canManage && (
        // Форма, а не кнопка с обработчиком: так браузер сам проверяет адрес
        // (type=email) и не пускает к серверу строку без домена.
        <form
          onSubmit={(event) => {
            event.preventDefault();
            invite.mutate({ email: email.trim(), role: "member" });
          }}
          className="flex items-end gap-2"
        >
          <label className="flex flex-1 flex-col gap-1.5">
            <span className="text-sm font-medium">Invite a teammate</span>
            <input
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="teammate@agency.com"
              className={cn(controlClass, "h-10 px-3")}
            />
          </label>
          <button
            type="submit"
            disabled={!email || invite.isPending}
            className={buttonClass("outline", "lg")}
          >
            {invite.isPending ? "Sending…" : "Send invite"}
          </button>
        </form>
      )}

      {invite.error && (
        <p role="alert" data-testid="invite-error" className="text-sm text-destructive">
          {invite.error.message}
        </p>
      )}

      {invited && (
        // Ссылка показывается всегда, даже когда письмо ушло: почта может
        // задержаться или попасть в спам, а пригласить человека надо сейчас.
        <p data-testid="invite-link" className="text-sm text-muted-foreground">
          {invited.delivered
            ? "Invitation sent. Direct link: "
            : "The email did not go out. Share this link: "}
          <code className="select-all break-all">{invited.link}</code>
        </p>
      )}

      {invites.data && invites.data.length > 0 && (
        <ul className="flex flex-col gap-1 text-sm text-muted-foreground">
          {invites.data.map((pending) => (
            <li key={pending.id} className="flex items-center justify-between gap-3">
              <span>Invited: {pending.email}</span>
              {canManage && (
                <button
                  type="button"
                  onClick={() => revokeInvite.mutate({ id: pending.id })}
                  disabled={revokeInvite.isPending}
                  className={buttonClass("ghost", "sm")}
                >
                  Revoke
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
