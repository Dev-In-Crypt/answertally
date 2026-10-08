/**
 * Реквизиты и даты юридических страниц.
 *
 * Сюда не вписано юридическое лицо: его ещё нет. Страницы от этого не
 * ломаются — они показывают то, что известно, и честно говорят, чего не
 * знают. Выдуманное название компании в условиях хуже отсутствующего:
 * договор с несуществующим лицом не значит ничего, а человек решит, что
 * значит.
 *
 * Когда лицо появится, заполняются переменные окружения — правок в коде
 * не потребуется.
 */

export interface LegalEntity {
  /** Юридическое название, как в регистрации. */
  name: string;
  /** Адрес одной строкой. */
  address: string;
  /** Регистрационный номер, если он есть у этой формы. */
  registration: string | null;
  /** Право, по которому толкуются условия. */
  governingLaw: string;
  /** Куда писать по вопросам о данных. */
  contactEmail: string;
}

function readEntity(): LegalEntity | null {
  const name = process.env.NEXT_PUBLIC_LEGAL_ENTITY?.trim();
  const address = process.env.NEXT_PUBLIC_LEGAL_ADDRESS?.trim();
  const contactEmail = process.env.NEXT_PUBLIC_LEGAL_EMAIL?.trim();
  const governingLaw = process.env.NEXT_PUBLIC_LEGAL_LAW?.trim();

  // Неполные реквизиты — это те же отсутствующие: условия без адреса и
  // права, по которому они читаются, не работают ни в чью пользу.
  if (!name || !address || !contactEmail || !governingLaw) return null;

  return {
    name,
    address,
    contactEmail,
    governingLaw,
    registration: process.env.NEXT_PUBLIC_LEGAL_REGISTRATION?.trim() || null,
  };
}

/** `null` — лицо ещё не заведено, и страницы говорят об этом прямо. */
export const LEGAL_ENTITY: LegalEntity | null = readEntity();

/**
 * Дата последнего изменения документов.
 *
 * Одна на все страницы намеренно: расходящиеся даты у документов, которые
 * ссылаются друг на друга, — первый признак того, что их не сверяли.
 */
export const LEGAL_LAST_UPDATED = "2026-10-08";

/**
 * Через сколько дней вступают в силу изменения в списке субподрядчиков.
 *
 * Срок назван в самом списке и в DPA. Молчаливая замена субподрядчика —
 * это ровно то, из-за чего агентство не может отвечать перед своим
 * клиентом за то, где лежат его данные.
 */
export const SUBPROCESSOR_NOTICE_DAYS = 30;
