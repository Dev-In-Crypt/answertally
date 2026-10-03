/**
 * Что из хранилища можно отдать без входа — и с какими заголовками.
 *
 * Только логотипы агентств: они попадают в клиентские отчёты, которые
 * открываются без входа. В том же хранилище лежат сырые ответы ассистентов
 * про клиентов и напечатанные отчёты — раньше маршрут отдавал и их, любому,
 * кто знает путь. Защищало только то, что в пути длинный случайный
 * идентификатор, а не проверка «чьё это»; это нарушало изоляцию агентств.
 * Сырые ответы продукт читает из базы, PDF — своим маршрутом с проверкой
 * владельца, так что сюда им ходить незачем.
 */

const LOGO_KEY = /^agencies\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/logo\.(png|jpg|webp|svg)$/;

const TYPE_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  webp: "image/webp",
  svg: "image/svg+xml",
};

/**
 * Тип по расширению, а не тот, что прислал загрузивший: браузер называет
 * тип файла сам, и назвать можно что угодно. `null` — файл не публичный.
 */
export function publicFileType(key: string): string | null {
  const match = LOGO_KEY.exec(key);
  return match?.[1] ? (TYPE_BY_EXTENSION[match[1]] ?? null) : null;
}

/**
 * SVG — документ, и в нём может быть скрипт. В `<img>` он не исполняется,
 * но по прямой ссылке исполнился бы на домене продукта от имени открывшего —
 * то есть с его входом в чужое агентство. `sandbox` запрещает скрипты при
 * любом открытии, `nosniff` — угадывание типа браузером.
 */
export const PUBLIC_FILE_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox",
};
