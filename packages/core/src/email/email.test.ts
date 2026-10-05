import { describe, expect, it, vi } from "vitest";
import * as templates from "./templates";
import {
  EMAIL_COPY,
  inviteEmail,
  passwordResetEmail,
  verifyEmailEmail,
  reportReadyEmail,
  type InviteEmailInput,
  type PasswordResetEmailInput,
  type ReportReadyEmailInput,
} from "./templates";
import {
  MemoryEmailSender,
  createEmailFailureLog,
  createEmailLog,
  emailLogFields,
} from "./memory";
import { ResendEmailSender, composeFrom, parseRetryAfter, withDisplayName } from "./resend";
import { createEmailSender, parseEmailMode } from "./registry";
import { createLogger, type LogLevel } from "../observability/logger";
import type { EmailMessage } from "./types";

/**
 * Verify T85: почта работает без ключа (складывается в память), с ключом
 * уходит в транспорт, а отказ по существу не превращается в три попытки.
 */

const INVITE: InviteEmailInput = {
  to: "colleague@agency.test",
  agencyName: "Northwind Studio",
  role: "member",
  inviteUrl: "https://app.test/invite/abc123",
  invitedByName: "Dana",
};

const RESET: PasswordResetEmailInput = {
  to: "owner@agency.test",
  resetUrl: "https://app.test/reset-password?token=xyz",
};

const REPORT: ReportReadyEmailInput = {
  to: "client@fernpost.test",
  agencyName: "Northwind Studio",
  clientName: "Fernpost",
  periodStart: "2026-04-01",
  periodEnd: "2026-06-30",
  reportUrl: "https://reports.northwind.test/r/abc",
};

/**
 * Все письма продукта. Список сверяется с модулем шаблонов отдельным тестом:
 * руками его вести нельзя — четвёртое письмо просто не попало бы в общие
 * проверки, и никто бы этого не заметил.
 */
const VERIFY = {
  to: "owner@northwind.test",
  verifyUrl: "https://app.test/verify-email?token=abc",
};

const SAMPLES: Record<string, EmailMessage> = {
  inviteEmail: inviteEmail(INVITE),
  verifyEmailEmail: verifyEmailEmail(VERIFY),
  passwordResetEmail: passwordResetEmail(RESET),
  reportReadyEmail: reportReadyEmail(REPORT),
};

const ALL_MESSAGES: ReadonlyArray<readonly [string, EmailMessage]> = Object.entries(SAMPLES);

/** Шаблоны, какие есть в модуле: по ним и сверяется список. */
function exportedTemplateNames(): string[] {
  return Object.entries(templates)
    .filter(([name, value]) => typeof value === "function" && name.endsWith("Email"))
    .map(([name]) => name)
    .sort();
}

describe("email templates", () => {
  it("каждый шаблон модуля проходит общие проверки", () => {
    // Падает ровно тогда, когда письмо добавили, а образца для него нет:
    // без этого новое письмо молча прошло бы мимо всех проверок ниже.
    expect(exportedTemplateNames()).toEqual(Object.keys(SAMPLES).sort());
  });

  it("приглашение несёт ссылку, агентство и роль", () => {
    const message = inviteEmail(INVITE);

    expect(message.to).toBe("colleague@agency.test");
    expect(message.subject).toContain("Northwind Studio");
    expect(message.text).toContain("https://app.test/invite/abc123");
    expect(message.text).toContain("Dana");
    expect(message.html).toContain("https://app.test/invite/abc123");
  });

  it("письмо о сбросе пароля говорит, что бездействие ничего не меняет", () => {
    const message = passwordResetEmail(RESET);

    expect(message.text).toContain("https://app.test/reset-password?token=xyz");
    // Человек, который письма не ждал, должен понять, что делать: ничего.
    expect(message.text).toMatch(/ignore this email/i);
    expect(message.html).toMatch(/ignore this email/i);
    // Ящика для ответа здесь нет намеренно — на такое письмо не отвечают.
    expect(message.replyTo).toBeUndefined();
  });

  it("письмо с подтверждением адреса говорит, чем кончится бездействие", () => {
    const message = verifyEmailEmail(VERIFY);

    expect(message.text).toContain("https://app.test/verify-email?token=abc");
    // Тот, кто не регистрировался, должен понять, что делать: ничего.
    expect(message.text).toMatch(/ignore this email/i);
    expect(message.html).toMatch(/ignore this email/i);
    // Ящика для ответа нет: рядом со ссылкой он приманка для самозванца.
    expect(message.replyTo).toBeUndefined();
  });

  it("письмо об отчёте несёт период, ссылку и приписку агентства", () => {
    const message = reportReadyEmail({ ...REPORT, note: "Call me if the sources look off." });

    expect(message.subject).toContain("Fernpost");
    expect(message.subject).toContain("1 Apr – 30 Jun 2026");
    expect(message.text).toContain("https://reports.northwind.test/r/abc");
    expect(message.text).toContain("Call me if the sources look off.");
    expect(message.html).toContain("Call me if the sources look off.");
    expect(message.html).toContain("https://reports.northwind.test/r/abc");
  });

  it.each(ALL_MESSAGES)("%s: есть и текст, и разметка", (_name, message) => {
    // Текстовая версия обязательна: без неё письмо читается не везде и чаще
    // попадает в спам.
    expect(message.text.trim().length).toBeGreaterThan(40);
    expect(message.html?.trim().length ?? 0).toBeGreaterThan(40);
    expect(message.html).toContain("<p>");
  });

  it.each(ALL_MESSAGES)("%s: ссылка в письме абсолютная", (_name, message) => {
    const links = message.text.match(/https?:\/\/\S+/g) ?? [];
    expect(links.length).toBeGreaterThan(0);

    const hrefs = [...(message.html ?? "").matchAll(/href="([^"]+)"/g)].map((match) => match[1]);
    expect(hrefs.length).toBeGreaterThan(0);
    for (const href of hrefs) {
      expect(href).toMatch(/^https?:\/\//);
    }
  });

  it.each(ALL_MESSAGES)("%s: тема без признаков рассылки", (_name, message) => {
    // Не про вкус: заглавные буквы, восклицания и слова про деньги — то, по
    // чему фильтры понижают письмо ещё до того, как его кто-то откроет.
    expect(message.subject.length).toBeLessThanOrEqual(78);
    expect(message.subject).not.toMatch(/[!$]/);
    expect(message.subject).not.toMatch(/\b(free|urgent|act now|winner|guarantee\w*)\b/i);
    expect(message.subject).not.toMatch(/\b[A-Z]{4,}\b/);
    expect(message.subject.trim()).toBe(message.subject);
  });

  it("относительная ссылка отвергается, а не уходит мёртвой", () => {
    expect(() => inviteEmail({ ...INVITE, inviteUrl: "/invite/abc123" })).toThrow(/absolute/i);
    expect(() => passwordResetEmail({ ...RESET, resetUrl: "app.test/reset" })).toThrow(
      /absolute/i,
    );
    expect(() => reportReadyEmail({ ...REPORT, reportUrl: "" })).toThrow(/reportUrl/);
    expect(() => verifyEmailEmail({ ...VERIFY, verifyUrl: "/verify" })).toThrow(/absolute/i);
  });

  it("имя агентства в HTML экранируется", () => {
    const message = inviteEmail({
      ...INVITE,
      agencyName: '<script>alert("x")</script>',
      role: "admin",
    });

    expect(message.html).not.toContain("<script>");
    expect(message.html).toContain("&lt;script&gt;");
  });

  it("имя клиента и приписка агентства в HTML экранируются", () => {
    // Оба поля приходят из данных агентства, то есть из формы, а не из кода.
    const message = reportReadyEmail({
      ...REPORT,
      clientName: '<img src=x onerror="alert(1)">',
      note: "<b>read this</b>",
    });

    expect(message.html).not.toContain("<img");
    expect(message.html).not.toContain("<b>read this</b>");
    expect(message.html).toContain("&lt;img");
    expect(message.html).toContain("&lt;b&gt;read this&lt;/b&gt;");
  });

  it("в письме клиенту агентства нет продукта нигде", () => {
    // Инвариант 3: клиент видит агентство — в теме, в тексте, в разметке и в
    // поле «От». Название продукта не всплывает ни в одном из них.
    const message = reportReadyEmail(REPORT);
    const product = EMAIL_COPY.productName.toLowerCase();

    for (const part of [message.subject, message.text, message.html ?? "", message.fromName ?? ""]) {
      expect(part.toLowerCase()).not.toContain(product);
    }
    expect(message.fromName).toBe("Northwind Studio");
    expect(message.text).toContain("Sent by Northwind Studio.");
  });

  it("адрес для ответа подставляется там, где ответ ждут", () => {
    const invite = inviteEmail({ ...INVITE, invitedByEmail: "dana@northwind.test" });
    expect(invite.replyTo).toBe("dana@northwind.test");

    const report = reportReadyEmail({ ...REPORT, agencyReplyTo: "hello@northwind.test" });
    expect(report.replyTo).toBe("hello@northwind.test");

    // Без адреса поле не появляется пустым: пустой reply-to хуже отсутствующего.
    expect(inviteEmail(INVITE).replyTo).toBeUndefined();
    expect(reportReadyEmail(REPORT).replyTo).toBeUndefined();
  });
});

describe("MemoryEmailSender", () => {
  it("складывает письма и отдаёт последнее адресату", async () => {
    const sender = new MemoryEmailSender();

    await sender.send({ to: "a@test", subject: "First", text: "one" });
    await sender.send({ to: "b@test", subject: "Other", text: "two" });
    await sender.send({ to: "a@test", subject: "Second", text: "three" });

    expect(sender.sent).toHaveLength(3);
    expect(sender.lastTo("a@test")?.subject).toBe("Second");
    expect(sender.lastTo("nobody@test")).toBeUndefined();
  });

  it("список писем не растёт бесконечно", async () => {
    // Режим по умолчанию — рабочий, процесс живёт неделями: без потолка это
    // утечка памяти, растущая ровно с числом приглашений.
    const sender = new MemoryEmailSender(null, 2);

    const first = await sender.send({ to: "a@test", subject: "1", text: "one" });
    await sender.send({ to: "b@test", subject: "2", text: "two" });
    const third = await sender.send({ to: "c@test", subject: "3", text: "three" });

    expect(sender.sent.map((message) => message.subject)).toEqual(["2", "3"]);
    // Идентификаторы остаются разными даже после вытеснения.
    expect(first.id).toBe("memory-1");
    expect(third.id).toBe("memory-3");
    // Письмо только записано: интерфейс не должен называть его отправленным.
    expect(third.logged).toBe(true);
  });

  it("режим без транспорта пишет письмо целиком структурной строкой", () => {
    const lines: string[] = [];
    const levels: LogLevel[] = [];
    const logger = createLogger({
      sink: (line, level) => {
        lines.push(line);
        levels.push(level);
      },
    });

    const sender = new MemoryEmailSender(createEmailLog(logger));
    void sender.send(inviteEmail(INVITE));

    expect(levels).toEqual(["info"]);
    const record = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(record["event"]).toBe("email.logged");
    expect(record["to"]).toBe("colleague@agency.test");
    expect(record["subject"]).toContain("Northwind Studio");
    // Ради этой ссылки лог и существует: другого способа получить её нет.
    expect(String(record["body"])).toContain("https://app.test/invite/abc123");
    // Разметка в лог не идёт — только её размер.
    expect(JSON.stringify(record)).not.toContain("<p>");
    expect(record["htmlBytes"]).toBeGreaterThan(0);
  });

  it("не ушедшее письмо записывается уровнем error вместе с причиной", () => {
    const lines: string[] = [];
    const logger = createLogger({ sink: (line) => lines.push(line) });

    createEmailFailureLog(logger)(inviteEmail(INVITE), new Error("transport is down"));

    const record = JSON.parse(lines[0] ?? "{}") as Record<string, unknown>;
    expect(record["level"]).toBe("error");
    expect(record["event"]).toBe("email.failed");
    expect(record["to"]).toBe("colleague@agency.test");
    expect(record["subject"]).toContain("Northwind Studio");
    expect(JSON.stringify(record["error"])).toContain("transport is down");
    expect(record["body"]).toBeUndefined();
  });

  it.each(ALL_MESSAGES)("%s: в записи об отказе нет ни ссылки, ни токена", (_name, message) => {
    /**
     * Строка об отказе живёт в логе хостинга и может уехать во внешний
     * сборщик ошибок. Ссылка на смену пароля и ссылка `/r/<токен>`, дающая
     * доступ к отчёту клиента без входа, туда попасть не должны: повторная
     * отправка стоит одного клика, а утёкший токен не отзовёшь.
     */
    const lines: string[] = [];
    const logger = createLogger({ sink: (line) => lines.push(line) });

    createEmailFailureLog(logger)(message, new Error("transport is down"));
    const record = lines[0] ?? "";

    expect(record).not.toContain("://");
    for (const link of message.text.match(/https?:\/\/\S+/g) ?? []) {
      expect(record).not.toContain(link);
      // И сам токен из ссылки — тоже: он опаснее ссылки целиком.
      for (const part of link.split(/[/?=]/).filter((piece) => piece.length >= 3)) {
        if (/^https?:$/.test(part) || part.includes(".")) continue;
        expect(record).not.toContain(part);
      }
    }
  });

  it("в запись попадают имя отправителя и адрес для ответа", () => {
    const fields = emailLogFields(
      reportReadyEmail({ ...REPORT, agencyReplyTo: "hello@northwind.test" }),
    );

    expect(fields["fromName"]).toBe("Northwind Studio");
    expect(fields["replyTo"]).toBe("hello@northwind.test");
  });
});

describe("ResendEmailSender", () => {
  function okResponse(id: string): Response {
    return new Response(JSON.stringify({ id }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }

  function payloadOf(fetchImpl: { mock: { calls: unknown[] } }, call = 0): Record<string, unknown> {
    const [, init] = fetchImpl.mock.calls[call] as unknown as [string, RequestInit];
    return JSON.parse(String(init.body)) as Record<string, unknown>;
  }

  it("отправляет письмо и возвращает идентификатор", async () => {
    const fetchImpl = vi.fn(async () => okResponse("msg_1"));

    const sender = new ResendEmailSender({
      apiKey: "test-key",
      from: "Answertally <noreply@test>",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await sender.send({ to: "x@test", subject: "Hi", text: "body" });

    expect(result.id).toBe("msg_1");
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    const payload = payloadOf(fetchImpl);
    expect(payload["from"]).toBe("Answertally <noreply@test>");
    expect(payload["to"]).toEqual(["x@test"]);
  });

  it("письмо клиенту уходит под именем агентства, а не продукта", async () => {
    // Инвариант 3: клиент агентства не должен видеть продукт даже в поле «От».
    const fetchImpl = vi.fn(async () => okResponse("msg_2"));
    const sender = new ResendEmailSender({
      apiKey: "test-key",
      from: "Answertally <noreply@test>",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await sender.send(reportReadyEmail({ ...REPORT, agencyReplyTo: "hello@northwind.test" }));

    const payload = payloadOf(fetchImpl);
    expect(payload["from"]).toBe('"Northwind Studio" <noreply@test>');
    expect(payload["from"]).not.toContain("Answertally");
    // Ответ клиента приходит агентству, а не в технический ящик.
    expect(payload["reply_to"]).toEqual(["hello@northwind.test"]);
  });

  it("адрес без имени дополняется именем продукта", () => {
    // EMAIL_FROM=noreply@agency.com — законная настройка, но голый адрес в
    // поле «От» читается как машинная рассылка.
    expect(composeFrom("noreply@answertally.com")).toBe('"Answertally" <noreply@answertally.com>');
    expect(composeFrom("Answertally <noreply@test>")).toBe("Answertally <noreply@test>");
  });

  it("адрес для ответа не может дописать письму лишний заголовок", async () => {
    const fetchImpl = vi.fn(async () => okResponse("msg_3"));
    const sender = new ResendEmailSender({
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await sender.send({
      to: "x@test",
      subject: "Hi",
      text: "body",
      replyTo: "dana@test\r\nBcc: someone@else",
    });

    expect(payloadOf(fetchImpl)["reply_to"]).toEqual(["dana@testBcc: someone@else"]);
  });

  it("письмо без текстовой версии не отправляется", async () => {
    const fetchImpl = vi.fn(async () => okResponse("msg_4"));
    const sender = new ResendEmailSender({
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    await expect(
      sender.send({ to: "x@test", subject: "Hi", text: " ", html: "<p>only html</p>" }),
    ).rejects.toThrow(/plain-text/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("имя отправителя очищается от того, что ломает заголовок", () => {
    expect(withDisplayName("noreply@test", 'Evil "Co" <x>\r\nBcc: a@b')).toBe(
      '"Evil Co xBcc: a@b" <noreply@test>',
    );
    expect(withDisplayName("Answertally <noreply@test>", '""')).toBe("Answertally <noreply@test>");
  });

  it("повторяет попытку на 500 и добивается ответа", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response("upstream error", { status: 500 }))
      .mockResolvedValueOnce(okResponse("msg_2"));

    const sender = new ResendEmailSender({
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
    });

    await expect(sender.send({ to: "x@test", subject: "Hi", text: "body" })).resolves.toEqual({
      id: "msg_2",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("обрыв сети — это повод повторить, а не отказ", async () => {
    const fetchImpl = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("fetch failed"))
      .mockResolvedValueOnce(okResponse("msg_5"));

    const sender = new ResendEmailSender({
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
    });

    await expect(sender.send({ to: "x@test", subject: "Hi", text: "body" })).resolves.toEqual({
      id: "msg_5",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("на 429 ждёт столько, сколько попросил сервер", async () => {
    const waits: number[] = [];
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("slow down", { status: 429, headers: { "retry-after": "2" } }),
      )
      .mockResolvedValueOnce(okResponse("msg_6"));

    const sender = new ResendEmailSender({
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });

    await expect(sender.send({ to: "x@test", subject: "Hi", text: "body" })).resolves.toEqual({
      id: "msg_6",
    });
    expect(waits).toEqual([2000]);
  });

  it("пауза не превышает потолок, каким бы ни был Retry-After", async () => {
    const waits: number[] = [];
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        new Response("slow down", { status: 429, headers: { "retry-after": "600" } }),
      )
      .mockResolvedValueOnce(okResponse("msg_7"));

    const sender = new ResendEmailSender({
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxDelayMs: 3_000,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });

    await sender.send({ to: "x@test", subject: "Hi", text: "body" });
    expect(waits).toEqual([3000]);
  });

  it("паузы между попытками растут", async () => {
    const waits: number[] = [];
    const fetchImpl = vi.fn(async () => new Response("upstream error", { status: 503 }));

    const sender = new ResendEmailSender({
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      maxAttempts: 4,
      retryDelayMs: 100,
      sleep: async (ms) => {
        waits.push(ms);
      },
    });

    await expect(sender.send({ to: "x@test", subject: "Hi", text: "body" })).rejects.toThrow();
    // Три паузы на четыре попытки: после последней ждать уже нечего.
    expect(waits).toEqual([100, 200, 400]);
  });

  it("исчерпав попытки, объясняет причину и не теряет письмо", async () => {
    const lost: EmailMessage[] = [];
    const fetchImpl = vi.fn(async () => new Response("upstream error", { status: 502 }));

    const sender = new ResendEmailSender({
      apiKey: "test-key",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
      onFailure: (message) => lost.push(message),
    });

    const message = inviteEmail(INVITE);
    await expect(sender.send(message)).rejects.toThrow(/after 3 attempts.*502/s);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    // Письмо уходит в лог целиком: ссылка на приглашение не исчезает вместе с отказом.
    expect(lost).toEqual([message]);
    expect(lost[0]?.text).toContain("https://app.test/invite/abc123");
  });

  it("неверный ключ не повторяется, а сразу объясняет причину", async () => {
    const lost: EmailMessage[] = [];
    const fetchImpl = vi.fn(async () => new Response("invalid api key", { status: 401 }));

    const sender = new ResendEmailSender({
      apiKey: "wrong",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
      onFailure: (message) => lost.push(message),
    });

    await expect(sender.send({ to: "x@test", subject: "Hi", text: "body" })).rejects.toThrow(
      /401/,
    );
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(lost).toHaveLength(1);
  });

  it("ключ не попадает в текст ошибки", async () => {
    // Ошибка уходит в лог и в ответ tRPC — секрету там не место.
    const fetchImpl = vi.fn(async () => new Response("invalid api key", { status: 401 }));
    const sender = new ResendEmailSender({
      apiKey: "re_secret_value",
      fetchImpl: fetchImpl as unknown as typeof fetch,
      sleep: async () => {},
    });

    const error = await sender
      .send({ to: "x@test", subject: "Hi", text: "body" })
      .then(() => null)
      .catch((reason: unknown) => reason as Error);

    expect(error?.message).toContain("401");
    expect(error?.message).not.toContain("re_secret_value");
    expect(String(error?.stack)).not.toContain("re_secret_value");
  });

  it("без ключа не создаётся", () => {
    expect(() => new ResendEmailSender({ apiKey: "" })).toThrow(/RESEND_API_KEY/);
  });
});

describe("parseRetryAfter", () => {
  it("читает секунды и дату, а непонятное значение игнорирует", () => {
    const now = () => Date.parse("2026-09-23T10:00:00Z");

    expect(parseRetryAfter("30", now)).toBe(30_000);
    expect(parseRetryAfter(" 5 ", now)).toBe(5_000);
    expect(parseRetryAfter("Wed, 23 Sep 2026 10:00:10 GMT", now)).toBe(10_000);
    // Дата в прошлом — ждать нечего, но и отрицательной паузы не бывает.
    expect(parseRetryAfter("Wed, 23 Sep 2026 09:59:00 GMT", now)).toBe(0);
    expect(parseRetryAfter("soon", now)).toBeNull();
    expect(parseRetryAfter(null, now)).toBeNull();
  });
});

describe("createEmailSender", () => {
  it("по умолчанию письма никуда не уходят", async () => {
    const sender = createEmailSender({});
    expect(sender).toBeInstanceOf(MemoryEmailSender);

    await sender.send({ to: "x@test", subject: "Hi", text: "body" });
    expect((sender as MemoryEmailSender).sent).toHaveLength(1);
  });

  it("живой режим без ключа — понятная ошибка, а не тихий лог", () => {
    expect(() => createEmailSender({ EMAIL_MODE: "live" })).toThrow(/RESEND_API_KEY/);
    // Пробел вместо ключа — то же самое: переменная есть, ключа нет.
    expect(() => createEmailSender({ EMAIL_MODE: "live", RESEND_API_KEY: "  " })).toThrow(
      /RESEND_API_KEY/,
    );
  });

  it("живой режим с ключом даёт транспорт", () => {
    const sender = createEmailSender({ EMAIL_MODE: "live", RESEND_API_KEY: "k" });
    expect(sender).toBeInstanceOf(ResendEmailSender);
  });

  it("непонятное значение режима отвергается", () => {
    expect(() => parseEmailMode("maybe")).toThrow(/EMAIL_MODE/);
  });
});
