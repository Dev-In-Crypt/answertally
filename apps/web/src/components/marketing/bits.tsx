import Link from "next/link";
import type { ReactNode } from "react";
import { SALES_CONTACT } from "./content";

/** Мелкие повторяющиеся куски витрины. */

/**
 * Ссылка на разговор о тарифе, если контакт задан, иначе — на бесплатный
 * аудит. Звонок не обещается, пока звонить некуда.
 */
export function TalkOrAudit({ fallback = "Start with the free audit →" }: { fallback?: string }) {
  if (SALES_CONTACT) {
    return (
      <a className="link" href={SALES_CONTACT.href} data-testid="sales-contact">
        {SALES_CONTACT.label} →
      </a>
    );
  }
  return (
    <Link className="link" href="/free-audit">
      {fallback}
    </Link>
  );
}

/**
 * Строка трения под главной кнопкой: что человек получает и чем платит.
 * Без неё «Run a free audit» не говорит, нужна ли карта.
 */
export function CtaNote({ children = "Free for one brand. No card needed." }: { children?: ReactNode }) {
  return <p className="cta-note">{children}</p>;
}

/** Ссылка на методологию рядом с блоками, где много цифр. */
export function MethodLink({ children = "How we measure →" }: { children?: ReactNode }) {
  return (
    <Link className="link method-link" href="/method">
      {children}
    </Link>
  );
}

type Level = "low" | "medium" | "high";

/**
 * Уровень уверенности: столбики и слово. Цвет не используется нарочно —
 * «medium» зелёным читался бы как «хорошо», а это не оценка, а точность.
 */
export function Conf({ level, estimated = true }: { level: Level; estimated?: boolean }) {
  return (
    <span className={`conf ${level}`}>
      <span className="m" aria-hidden>
        <i />
        <i />
        <i />
      </span>
      {estimated ? "estimated · " : ""}confidence: {level}
    </span>
  );
}

export function SecHead({
  n,
  title,
  children,
  id,
}: {
  n: number;
  title: ReactNode;
  children?: ReactNode;
  id?: string;
}) {
  return (
    <div className="sec-head">
      <span className="n" aria-hidden>
        {n}
      </span>
      <h2 className="h1" id={id}>
        {title}
      </h2>
      {children && <p>{children}</p>}
    </div>
  );
}

export type ChipKind = "gap" | "has" | "plain";

export function SrcChip({ n, domain, kind, note }: { n: number; domain: string; kind: ChipKind; note?: string }) {
  return (
    <span className={`src-chip ${kind === "plain" ? "" : kind}`}>
      <span className="i">[{n}]</span>
      {domain}
      {note && <span className="g">· {note}</span>}
    </span>
  );
}

export function Faq({ items, testId }: { items: { q: string; a: ReactNode }[]; testId?: string }) {
  return (
    <div className="faq" data-testid={testId}>
      {items.map((item, i) => (
        <details key={item.q} open={i === 0}>
          <summary>{item.q}</summary>
          <p>{item.a}</p>
        </details>
      ))}
    </div>
  );
}

export function LegendLine({ kind }: { kind: "client" | "comp" | "control" | "band" }) {
  if (kind === "band") {
    return (
      <svg width="22" height="10" aria-hidden>
        <rect width="22" height="10" fill="rgb(0 166 62 / .12)" />
      </svg>
    );
  }
  if (kind === "client") {
    return (
      <svg width="22" height="8" aria-hidden>
        <line x1="0" y1="4" x2="22" y2="4" stroke="#00A63E" strokeWidth="2.5" />
        <circle cx="11" cy="4" r="3" fill="#00A63E" />
      </svg>
    );
  }
  if (kind === "control") {
    return (
      <svg width="22" height="8" aria-hidden>
        <line x1="0" y1="4" x2="22" y2="4" stroke="#5E6572" strokeWidth="2" strokeDasharray="2 3" />
      </svg>
    );
  }
  return (
    <svg width="22" height="8" aria-hidden>
      <line x1="0" y1="4" x2="22" y2="4" stroke="#F54900" strokeWidth="1.5" strokeDasharray="5 4" />
    </svg>
  );
}
