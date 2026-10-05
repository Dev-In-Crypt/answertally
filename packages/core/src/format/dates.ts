/**
 * Даты на экране и в отчётах — день, месяц словом, год: «4 Oct 2026».
 *
 * Числовой формат двусмыслен для международных агентств: «11/4/2026» в
 * США — 4 ноября, в Европе — 11 апреля. Месяц словом читается одинаково
 * везде. Дни периода (неделя, начало и конец отчёта) хранятся как дата без
 * времени, поэтому показываются в UTC: иначе к западу от Гринвича
 * «2026-09-04» превратился бы в 3 сентября.
 */

type DateInput = Date | string | number;

// Своя таблица, а не Intl: свежие ICU пишут сентябрь в en-GB как «Sept»,
// и одна дата выглядела бы по-разному на сервере и в браузере.
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** «4 Oct 2026» — для дней без времени: периоды, недели, сроки. */
export function formatDay(value: DateInput): string {
  const date = new Date(value);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

/** «4 Oct» — короткая подпись, где год понятен из контекста. */
export function formatDayShort(value: DateInput): string {
  const date = new Date(value);
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]}`;
}

/**
 * «4 Oct 2026, 22:52» — момент события, в часовом поясе того, кто смотрит.
 * Только на клиенте: на сервере пояс — серверный.
 */
export function formatDateTime(value: DateInput): string {
  const date = new Date(value);
  const time = `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
  return `${date.getDate()} ${MONTHS[date.getMonth()]} ${date.getFullYear()}, ${time}`;
}

/** «4 Sep – 4 Oct 2026»; год у начала — только если он другой. */
export function formatPeriod(start: DateInput, end: DateInput): string {
  const from = new Date(start);
  const to = new Date(end);
  const head =
    from.getUTCFullYear() === to.getUTCFullYear() ? formatDayShort(from) : formatDay(from);
  return `${head} – ${formatDay(to)}`;
}
