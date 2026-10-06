"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect } from "react";
import { BarChart3, CreditCard, FileText, Settings, Users } from "lucide-react";
import { api } from "@/trpc/react";
import { cn } from "@/lib/utils";
import { SignOutButton } from "@/components/sign-out-button";
import { ThemeToggle } from "@/components/theme-toggle";
import { Mark } from "@/components/ui/mark";
import { Wordmark } from "@/components/marketing/logo";

/**
 * Каркас приложения.
 *
 * Разделено не по смыслу, а по частоте. Сверху три пункта, ради которых
 * сюда заходят каждый день; внизу, прижатое к подписи агентства, — то, что
 * открывают раз в месяц. Семь равнозначных пунктов заставляли перечитывать
 * весь список, а три из них были нужны один раз в тридцать дней.
 *
 * Заголовков у групп нет: разделение читается расстоянием и чертой. Слово
 * «Account» ничего не добавляло — внизу и так стоит имя агентства.
 *
 * «Plan and usage» — один пункт, потому что это один вопрос: сколько
 * осталось и сколько за это платить. Рядом с ним стоит доля
 * израсходованных проверок — единственное число, за которым агентство
 * ходило на отдельный экран между делом.
 */

const WORK = [
  { href: "/dashboard", label: "Overview", icon: BarChart3 },
  { href: "/clients", label: "Clients", icon: Users },
  { href: "/reports", label: "Reports", icon: FileText },
] as const;

const AGENCY = [
  { href: "/settings/billing", label: "Plan and usage", icon: CreditCard },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

const NAV = [...WORK, ...AGENCY];

/**
 * Подсвечивается самый длинный подходящий пункт: иначе на /settings/usage
 * текущими оказались бы сразу два, и «где я» перестало бы читаться.
 */
function activeHref(pathname: string): string | undefined {
  return NAV.map((item) => item.href)
    .filter((href) => pathname === href || pathname.startsWith(`${href}/`))
    .sort((a, b) => b.length - a.length)[0];
}

/**
 * Имена, которые раньше выводились из домена личной почты. Агентство с таким
 * именем отправило бы клиенту отчёт с «Gmail» в шапке.
 */
const MAILBOX_NAMES = new Set([
  "gmail", "googlemail", "outlook", "hotmail", "live", "msn", "yahoo", "icloud", "me", "mac",
  "aol", "proton", "protonmail", "pm", "gmx", "yandex", "mail", "zoho", "fastmail", "my agency",
]);

function needsRealName(agencyName: string): boolean {
  return MAILBOX_NAMES.has(agencyName.trim().toLowerCase());
}

/** Подписи разделов клиента для заголовка вкладки — по последнему сегменту пути. */
const CLIENT_SECTIONS: Record<string, string> = {
  measure: "Measure",
  diagnose: "Diagnose",
  opportunities: "Opportunities",
  actions: "Actions",
  experiments: "Experiments",
  reports: "Reports",
  audit: "Audit",
  onboarding: "Set up",
  prompts: "Prompt",
  settings: "Client settings",
  new: "New client",
};

/**
 * Заголовок вкладки по адресу.
 *
 * Большинство экранов — клиентские компоненты и не могут объявить metadata,
 * а вкладки «Answertally», «Answertally», «Answertally» не различить.
 */
function tabTitle(pathname: string): string {
  const parts = pathname.split("/").filter(Boolean);
  const section =
    parts[0] === "clients" && parts.length > 1
      ? (CLIENT_SECTIONS[parts[2] ?? ""] ?? CLIENT_SECTIONS[parts[1] ?? ""] ?? "Client")
      : NAV.find((item) => item.href === activeHref(pathname))?.label;
  return section ? `${section} · Answertally` : "Answertally";
}

/**
 * Тип берётся из самих массивов, а не описывается как `href: string`:
 * типизированные роуты Next проверяют literal type ссылки, и обобщённая
 * строка перестаёт быть известным адресом.
 */
function NavGroup({
  items,
  current,
  label,
}: {
  items: typeof WORK | typeof AGENCY;
  current: string | undefined;
  label?: string;
}) {
  return (
    <div className="flex flex-col gap-0.5">
      {label && (
        <p className="px-2 pb-1 text-xs font-medium tracking-wide text-muted-foreground/70 uppercase">
          {label}
        </p>
      )}
      {items.map(({ href, label: text, icon: Icon }) => {
        const active = href === current;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "flex items-center gap-2.5 rounded-md px-2 py-1.5 text-sm transition-colors",
              // Подсветка акцентом, а не карточкой: в тёмной теме фон карточки
              // совпадает с фоном панели, и текущий пункт становится не виден.
              active
                ? "bg-primary/12 font-medium text-foreground"
                : "text-muted-foreground hover:bg-primary/6 hover:text-foreground",
            )}
          >
            <Icon
              className={cn("size-4 shrink-0", active ? "text-primary" : "text-muted-foreground")}
              aria-hidden
            />
            <span className="min-w-0 flex-1 truncate">{text}</span>
            {href === "/settings/billing" && <UsageBadge />}
          </Link>
        );
      })}
    </div>
  );
}

/**
 * Доля израсходованных проверок — прямо в пункте меню.
 *
 * Молчит, пока данных нет: значок, показывающий ноль на незагруженном
 * запросе, читался бы как «ничего не потрачено». Пока месяц не начался
 * тратиться, тоже молчит — 0% ничего не сообщает и только шумит.
 *
 * Перерасход красится, но ничего не отключает: обещание «перерасход не
 * режет посреди месяца» дано на странице тарифов, и значок ему не
 * противоречит — он предупреждает, а не угрожает.
 */
function UsageBadge() {
  const usage = api.billing.usage.useQuery(undefined, {
    // Цифра меняется прогонами, а не переходами между экранами.
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });

  const checks = usage.data?.aiChecks;
  if (!checks || checks.used === 0) return null;

  const pct = Math.round(checks.ratio * 100);

  return (
    <span
      data-testid="nav-usage"
      // Бесплатные проверки не обновляются по месяцам — это запас на всё время.
      title={
        checks.free
          ? `${checks.used.toLocaleString("en-US")} of ${checks.allowance.toLocaleString("en-US")} free AI checks used`
          : `${checks.used.toLocaleString("en-US")} of ${checks.allowance.toLocaleString("en-US")} AI checks used this month`
      }
      className={cn(
        "metric shrink-0 text-[11px] tabular-nums",
        checks.overAllowance ? "text-destructive" : "text-muted-foreground",
      )}
    >
      {pct}%
    </span>
  );
}

export function AppShell({
  agencyName,
  userEmail,
  children,
}: {
  agencyName: string;
  userEmail: string;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const current = activeHref(pathname);

  useEffect(() => {
    document.title = tabTitle(pathname);
  }, [pathname]);

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-56 shrink-0 flex-col border-r bg-secondary/40 px-3 py-4 md:flex">
        {/* Знак ведёт на сайт: иного пути из кабинета на главную нет. */}
        <Link href="/" className="mb-6 block px-2 py-1" title="Answertally home">
          <span className="block h-5 text-foreground [&>svg]:h-full [&>svg]:w-auto">
            <Wordmark />
          </span>
        </Link>

        <nav className="flex flex-col">
          <NavGroup items={WORK} current={current} />
        </nav>

        {/* Хозяйство агентства прижато к низу, к его же имени: сверху то,
            ради чего заходят, снизу то, что открывают раз в месяц. */}
        <nav className="mt-auto flex flex-col border-t pt-3">
          <NavGroup items={AGENCY} current={current} />
        </nav>

        <div className="mt-3 border-t px-2 pt-3">
          <p className="truncate text-sm font-medium" title={agencyName}>
            {agencyName}
          </p>
          <p className="truncate text-xs text-muted-foreground" title={userEmail}>
            {userEmail}
          </p>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {/*
          На телефоне сайдбара нет, и все шесть ссылок живут здесь. В 375
          пикселей они не помещаются, поэтому ряд прокручивается сам, а кнопки
          справа не сжимаются — горизонтальной прокрутки самой страницы это
          больше не создаёт.
        */}
        <header className="flex h-14 items-center justify-between gap-4 border-b px-4 sm:px-6">
          <div className="flex min-w-0 items-center gap-3 md:hidden">
            <Link href="/" aria-label="Answertally home" className="shrink-0">
              <Mark className="size-5" />
            </Link>
            {/* Правый край ряда гаснет: так видно, что пункты продолжаются за
                краем и до «Plan and usage» и «Settings» можно докрутить. */}
            <nav className="-mx-1 flex min-w-0 gap-3 overflow-x-auto px-1 pr-6 [mask-image:linear-gradient(to_right,black_calc(100%-2rem),transparent)]">
              {NAV.map(({ href, label }) => {
                const active = href === current;
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "shrink-0 text-sm whitespace-nowrap",
                      active ? "font-medium text-foreground" : "text-muted-foreground",
                    )}
                  >
                    {label}
                  </Link>
                );
              })}
            </nav>
          </div>

          <div className="ml-auto flex shrink-0 items-center gap-1">
            <ThemeToggle />
            <SignOutButton />
          </div>
        </header>

        {needsRealName(agencyName) && (
          <div
            role="status"
            data-testid="agency-name-banner"
            className="border-b bg-competitor/10 px-4 py-2 text-sm sm:px-6"
          >
            Your agency is named “{agencyName}”, and clients see this name at the top of every
            report.{" "}
            <Link href="/settings" className="font-medium underline underline-offset-2">
              Change it in Settings
            </Link>
          </div>
        )}
        <main className="min-w-0 flex-1 px-4 py-8 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
