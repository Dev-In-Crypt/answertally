import { formatPeriod } from "../format/dates";
import type { EmailMessage } from "./types";

/**
 * Тексты писем — чистые функции, как и вся остальная копия продукта.
 *
 * Два письма из трёх адресованы сотрудникам агентства, и на них ограничение
 * white-label не распространяется: это письма от продукта. Третье, со ссылкой
 * на отчёт, идёт клиенту агентства — там продукта не видно нигде, включая
 * поле «От» (инвариант 3).
 *
 * Ограничение на формулировки распространяется на все три: обещаний результата
 * в письмах нет, они только приводят человека в интерфейс.
 */

export const EMAIL_COPY = {
  productName: "Answertally",
  /** Отправитель по умолчанию. Домен переопределяется через EMAIL_FROM. */
  defaultFrom: "Answertally <noreply@answertally.com>",
} as const;

export interface InviteEmailInput {
  to: string;
  agencyName: string;
  role: "admin" | "member";
  inviteUrl: string;
  /** Кто пригласил — письмо от незнакомого адресата выглядит как спам. */
  invitedByName?: string;
  /** Почта пригласившего: «это правда ты?» должно уходить человеку, а не в никуда. */
  invitedByEmail?: string;
}

export function inviteEmail(input: InviteEmailInput): EmailMessage {
  const inviteUrl = requireAbsoluteUrl(input.inviteUrl, "inviteUrl");
  const invitedBy = input.invitedByName ? `${input.invitedByName} ` : "";
  const role = input.role === "admin" ? "an admin" : "a member";

  const text = [
    `${invitedBy}invited you to join ${input.agencyName} on ${EMAIL_COPY.productName} as ${role}.`,
    "",
    `Accept the invitation: ${inviteUrl}`,
    "",
    "The link works for seven days. If you were not expecting this, ignore the email — nothing happens until you open it.",
  ].join("\n");

  return {
    to: input.to,
    subject: `Join ${input.agencyName} on ${EMAIL_COPY.productName}`,
    text,
    html: paragraphs([
      `${escapeHtml(invitedBy)}invited you to join <strong>${escapeHtml(input.agencyName)}</strong> on ${EMAIL_COPY.productName} as ${role}.`,
      `<a href="${escapeHtml(inviteUrl)}">Accept the invitation</a>`,
      "The link works for seven days. If you were not expecting this, ignore the email — nothing happens until you open it.",
    ]),
    ...(input.invitedByEmail ? { replyTo: input.invitedByEmail } : {}),
  };
}

export interface PasswordResetEmailInput {
  to: string;
  resetUrl: string;
}

/**
 * Письмо о смене пароля.
 *
 * Адреса для ответа здесь нет намеренно: на такое письмо не отвечают, а
 * живой ящик рядом с ссылкой на смену пароля — приманка для того, кто
 * попробует выдать себя за поддержку.
 */
export function passwordResetEmail(input: PasswordResetEmailInput): EmailMessage {
  const resetUrl = requireAbsoluteUrl(input.resetUrl, "resetUrl");

  const text = [
    `Someone asked to reset the password for this ${EMAIL_COPY.productName} account.`,
    "",
    `Set a new password: ${resetUrl}`,
    "",
    "If it was not you, ignore this email — the password stays as it is until the link is opened.",
  ].join("\n");

  return {
    to: input.to,
    subject: `Reset your ${EMAIL_COPY.productName} password`,
    text,
    html: paragraphs([
      `Someone asked to reset the password for this ${EMAIL_COPY.productName} account.`,
      `<a href="${escapeHtml(resetUrl)}">Set a new password</a>`,
      "If it was not you, ignore this email — the password stays as it is until the link is opened.",
    ]),
  };
}

export interface VerifyEmailInput {
  to: string;
  verifyUrl: string;
}

/**
 * Письмо с подтверждением адреса при регистрации.
 *
 * Нужно не из вежливости: до подтверждения аккаунт не входит, а бесплатный
 * аудит стоит нам живых вызовов. Адрес, который невозможно открыть, —
 * главный признак того, что аккаунт заводят пачками.
 *
 * Адреса для ответа нет по той же причине, что и у смены пароля: живой ящик
 * рядом со ссылкой — приманка для того, кто выдаст себя за поддержку.
 */
export function verifyEmailEmail(input: VerifyEmailInput): EmailMessage {
  const verifyUrl = requireAbsoluteUrl(input.verifyUrl, "verifyUrl");

  const text = [
    `Confirm this address to finish setting up your ${EMAIL_COPY.productName} account.`,
    "",
    `Confirm your email: ${verifyUrl}`,
    "",
    "If you did not sign up, ignore this email — the account stays unusable until the link is opened.",
  ].join("\n");

  return {
    to: input.to,
    subject: `Confirm your email for ${EMAIL_COPY.productName}`,
    text,
    html: paragraphs([
      `Confirm this address to finish setting up your ${EMAIL_COPY.productName} account.`,
      `<a href="${escapeHtml(verifyUrl)}">Confirm your email</a>`,
      "If you did not sign up, ignore this email — the account stays unusable until the link is opened.",
    ]),
  };
}

export interface ReportReadyEmailInput {
  to: string;
  agencyName: string;
  clientName: string;
  periodStart: string;
  periodEnd: string;
  reportUrl: string;
  /** Приписка от агентства своими словами. */
  note?: string;
  /** Ящик агентства: клиент отвечает агентству, а не техническому адресу. */
  agencyReplyTo?: string;
}

/**
 * Письмо клиенту агентства со ссылкой на отчёт.
 *
 * Здесь действует white-label (инвариант 3): письмо подписано агентством, и
 * названия продукта в нём нет. Ссылка, а не вложение: документ живёт на
 * своей странице, где его можно согласовать, и не расходится копиями.
 */
export function reportReadyEmail(input: ReportReadyEmailInput): EmailMessage {
  const reportUrl = requireAbsoluteUrl(input.reportUrl, "reportUrl");
  const period = formatPeriod(input.periodStart, input.periodEnd);

  const text = [
    `Your AI answer visibility report for ${input.clientName} is ready.`,
    `Period: ${period}.`,
    ...(input.note ? ["", input.note] : []),
    "",
    `Read it here: ${reportUrl}`,
    "",
    "Every figure in it is an estimate from repeated samples of assistant answers, and the report says where that is uncertain.",
    "",
    `Sent by ${input.agencyName}.`,
  ].join("\n");

  return {
    to: input.to,
    // Клиент видит в поле «От» агентство, а не продукт.
    fromName: input.agencyName,
    subject: `${input.clientName}: AI answer visibility, ${period}`,
    text,
    html: paragraphs([
      `Your AI answer visibility report for <strong>${escapeHtml(input.clientName)}</strong> is ready.`,
      `Period: ${escapeHtml(period)}.`,
      ...(input.note ? [escapeHtml(input.note)] : []),
      `<a href="${escapeHtml(reportUrl)}">Read the report</a>`,
      "Every figure in it is an estimate from repeated samples of assistant answers, and the report says where that is uncertain.",
      `Sent by ${escapeHtml(input.agencyName)}.`,
    ]),
    ...(input.agencyReplyTo ? { replyTo: input.agencyReplyTo } : {}),
  };
}

function paragraphs(lines: readonly string[]): string {
  return lines.map((line) => `<p>${line}</p>`).join("\n");
}

/**
 * Ссылка в письме обязана быть абсолютной: относительный путь в почтовом
 * клиенте никуда не ведёт, и человек упирается в тупик молча. Лучше шумный
 * отказ при сборке письма, чем мёртвая ссылка у получателя.
 */
function requireAbsoluteUrl(value: string, field: string): string {
  const url = value.trim();
  if (!/^https?:\/\/\S/i.test(url)) {
    throw new Error(`${field} must be an absolute http(s) URL, received "${value}".`);
  }
  return url;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
