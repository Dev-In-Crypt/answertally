import { createDb, type Database } from "@repo/db";

/**
 * Одно подключение к базе на процесс веба.
 *
 * Страницы и маршруты открывали свой пул на каждый запрос, включая
 * анонимные (`/r/[token]`, `/api/health`). Сотня одновременных заходов по
 * случайным ссылкам исчерпывала подключения Postgres — и вставало всё: вход,
 * панель, воркер.
 *
 * Пул хранится на globalThis: в разработке Next перезагружает модули, и
 * каждая перезагрузка иначе открывала бы ещё десять подключений.
 */
const holder = globalThis as unknown as { answertallyDb?: Database };

export const db: Database = (holder.answertallyDb ??= createDb().db);
