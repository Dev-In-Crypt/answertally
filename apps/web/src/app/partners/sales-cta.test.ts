import { describe, expect, it } from "vitest";
import { SALES_CONTACT, salesContactFrom } from "@/config/site";
import { AUDIT_FALLBACK, salesCtaTarget } from "./sales-cta";

/**
 * Контакт продаж обещает живого человека. Пока адреса нет, обещания быть не
 * должно — это проверяется здесь, а не соглашением: страница, зовущая на
 * звонок, которого некому принять, стоит дороже, чем отсутствующая кнопка.
 */
describe("кнопка разговора с человеком", () => {
  it("без контакта зовёт на бесплатный аудит, а не на звонок", () => {
    expect(salesCtaTarget(null)).toEqual({ kind: "audit", label: AUDIT_FALLBACK.label });
  });

  it("можно задать свою подпись запасного пути", () => {
    expect(salesCtaTarget(null, "See a sample report")).toEqual({
      kind: "audit",
      label: "See a sample report",
    });
  });

  it("с контактом зовёт к человеку и подписью берёт его подпись", () => {
    const target = salesCtaTarget({ label: "Talk to the founder", href: "mailto:a@b.example" });

    expect(target).toEqual({ kind: "sales", label: "Talk to the founder" });
  });

  it("запасная подпись с заданным контактом не используется", () => {
    const target = salesCtaTarget({ label: "Book a call", href: "https://cal.example/x" }, "Audit");

    expect(target.label).toBe("Book a call");
  });

  it("без переменных окружения контакта нет, и страницы это видят", () => {
    // NEXT_PUBLIC_SALES_* в тестовом окружении не заданы — значит, и в сборке
    // без них кнопки разговора не появится.
    expect(SALES_CONTACT).toBeNull();
    expect(salesCtaTarget(SALES_CONTACT).kind).toBe("audit");
  });
});

describe("контакт продаж из окружения", () => {
  it("ссылка без подписи — запись на разбор", () => {
    expect(salesContactFrom({ url: " https://cal.example/x " })).toEqual({
      label: "Book a 20-min walkthrough",
      href: "https://cal.example/x",
    });
  });

  it("только почта — mailto и «Talk to us»", () => {
    expect(salesContactFrom({ email: "hi@b.example" })).toEqual({
      label: "Talk to us",
      href: "mailto:hi@b.example",
    });
  });

  it("ссылка важнее почты, своя подпись важнее умолчания", () => {
    expect(
      salesContactFrom({ url: "https://cal.example/x", email: "hi@b.example", label: "Book a call" }),
    ).toEqual({ label: "Book a call", href: "https://cal.example/x" });
  });

  it("ни ссылки, ни почты — контакта нет, даже с подписью", () => {
    expect(salesContactFrom({})).toBeNull();
    expect(salesContactFrom({ url: " ", email: "", label: "Talk" })).toBeNull();
  });
});
