/**
 * Настройки сайта, которые зависят от окружения, а не от кода.
 *
 * Контакт основателя — единственное место, где сайт обещает живого человека.
 * Пока адреса нет, обещания нет: кнопки ведут на бесплатный аудит. Поэтому
 * значение читается из переменной окружения и может отсутствовать.
 *
 * Переменные с префиксом NEXT_PUBLIC_ попадают в бандл — здесь это осознанно:
 * контакт для продаж и так публичный, его печатают на странице.
 */

export interface SalesContact {
  /** Что написано на кнопке. */
  label: string;
  /** Куда она ведёт: mailto: или ссылка на календарь. */
  href: string;
}

/**
 * Контакт из сырых значений окружения. Отдельно от чтения process.env, чтобы
 * тест мог проверить все случаи; сами переменные читаются ниже буквально —
 * иначе Next не подставит их в бандл.
 */
export function salesContactFrom(env: {
  url?: string;
  email?: string;
  label?: string;
}): SalesContact | null {
  const url = env.url?.trim();
  const email = env.email?.trim();
  const label = env.label?.trim();

  if (url) return { label: label || "Book a 20-min walkthrough", href: url };
  if (email) return { label: label || "Talk to us", href: `mailto:${email}` };
  return null;
}

/** null — контакта нет, и обещать звонок нельзя. */
export const SALES_CONTACT: SalesContact | null = salesContactFrom({
  url: process.env.NEXT_PUBLIC_SALES_URL,
  email: process.env.NEXT_PUBLIC_SALES_EMAIL,
  label: process.env.NEXT_PUBLIC_SALES_LABEL,
});

/**
 * Домен, на котором отдаются клиентские отчёты.
 *
 * Пусто — отчёты живут на том же домене, что и продукт. Свой домен агентства
 * — это то, ради чего white-label существует: ссылка, которую клиент
 * открывает, не должна вести на чужой бренд.
 */
export const REPORT_HOST: string | null = process.env.NEXT_PUBLIC_REPORT_HOST?.trim() || null;

/**
 * Почта поддержки — та же, что указана в магазине у платёжного провайдера.
 *
 * Провайдер оплаты проверяет, что её видно на сайте (подвал и юридические
 * страницы), и сверяет с адресом в чеках. Адрес публичный, поэтому в коде.
 */
export const SUPPORT_EMAIL = "support@answertally.com";


/**
 * Публичный адрес сайта — для поисковиков и превью ссылок.
 *
 * Константа, а не переменная окружения: публичные страницы собираются
 * заранее, и адрес из окружения сборки (localhost в CI) попал бы в карту
 * сайта и в превью навсегда.
 */
export const SITE_URL = "https://answertally.com";
