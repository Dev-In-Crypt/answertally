import { afterEach, describe, expect, it } from "vitest";
import { MemoryEmailSender } from "@repo/core";
import { appUrl, getEmailSender, setEmailSender } from "./email";

/**
 * Почта на стороне приложения: без ключа продукт работает, с включённым
 * живым режимом и без ключа — понятный отказ при отправке, а не падение
 * сборки страницы, которая писем не шлёт.
 *
 * Сам факт, что этот файл импортировался, уже проверяет половину условия:
 * импорт не трогает окружение и не создаёт транспорт.
 */

const ENV_KEYS = ["EMAIL_MODE", "RESEND_API_KEY", "NEXT_PUBLIC_APP_URL", "BETTER_AUTH_URL"];

const original = new Map(ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const [key, value] of original) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  setEmailSender(null);
});

describe("getEmailSender", () => {
  it("без ключа даёт рабочий отправитель, а не отказ", async () => {
    delete process.env["EMAIL_MODE"];
    delete process.env["RESEND_API_KEY"];
    setEmailSender(null);

    const sender = getEmailSender();
    expect(sender).toBeInstanceOf(MemoryEmailSender);

    await sender.send({ to: "someone@agency.test", subject: "Hi", text: "body" });
    expect((sender as MemoryEmailSender).sent).toHaveLength(1);
  });

  it("живой режим без ключа отказывает при отправке и называет переменную", () => {
    process.env["EMAIL_MODE"] = "live";
    delete process.env["RESEND_API_KEY"];
    setEmailSender(null);

    expect(() => getEmailSender()).toThrow(/RESEND_API_KEY/);
  });

  it("отправитель один на процесс, пока его не подменили", () => {
    delete process.env["EMAIL_MODE"];
    setEmailSender(null);

    expect(getEmailSender()).toBe(getEmailSender());

    const mailbox = new MemoryEmailSender();
    setEmailSender(mailbox);
    expect(getEmailSender()).toBe(mailbox);
  });
});

describe("appUrl", () => {
  it("отдаёт абсолютный адрес без хвостовой косой черты", () => {
    process.env["NEXT_PUBLIC_APP_URL"] = "https://app.answertally.test/";
    expect(appUrl()).toBe("https://app.answertally.test");
  });

  it("берёт адрес авторизации, если своего нет", () => {
    delete process.env["NEXT_PUBLIC_APP_URL"];
    process.env["BETTER_AUTH_URL"] = "https://auth.answertally.test";
    expect(appUrl()).toBe("https://auth.answertally.test");
  });

  it("адрес без схемы отвергается: такая ссылка в письме мертва", () => {
    process.env["NEXT_PUBLIC_APP_URL"] = "app.answertally.test";
    expect(() => appUrl()).toThrow(/NEXT_PUBLIC_APP_URL/);
  });
});
