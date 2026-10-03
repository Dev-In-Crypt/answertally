import { afterAll, describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { canonicalEmail } from "@repo/core";
import { canonicalEmailSql, createDb } from "@repo/db";

/**
 * Канонический адрес считается дважды — в TypeScript при регистрации и в SQL
 * при поиске уже заведённого аккаунта. Разойдутся — и вариант адреса снова
 * получит бесплатный аудит. Тест сверяет оба на одних примерах.
 */

const { db, close } = createDb();

afterAll(async () => {
  await close();
});

const INPUTS = [
  "Ab@Gmail.com",
  "a.b@gmail.com",
  "a.b+promo@gmail.com",
  "ab@googlemail.com",
  "a.b@agency.com",
  "a.b+x@agency.com",
  "Owner@Agency.COM",
];

describe("canonicalEmailSql совпадает с canonicalEmail", () => {
  it.each(INPUTS)("%s", async (input) => {
    const rows = (await db.execute(
      sql`select ${canonicalEmailSql(sql`${input}::text`)} as c`,
    )) as unknown as { c: string }[] | { rows: { c: string }[] };
    const value = Array.isArray(rows) ? rows[0]?.c : rows.rows[0]?.c;
    expect(value).toBe(canonicalEmail(input));
  });
});
