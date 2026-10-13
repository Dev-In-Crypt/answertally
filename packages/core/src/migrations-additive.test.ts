import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * Миграции только добавляют: ADD COLUMN, CREATE TABLE / INDEX.
 *
 * На этом держится откат выкладки (scripts/rollback.sh): он возвращает
 * старый код, но не старую схему. Старый код на схеме, где что-то только
 * добавилось, работает; на схеме, где колонку удалили или переименовали, —
 * нет, и откат превращается в восстановление из копии.
 *
 * Тест лежит здесь, а не в packages/db: тесты базы требуют Postgres, а этот
 * читает только файлы.
 *
 * Миграции до 0030 включительно написаны до правила и разрешены как есть.
 * Если разрушающая миграция действительно нужна — строка
 * `-- allow-destructive: <причина>` в её файле.
 */

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const MIGRATIONS = join(REPO_ROOT, "packages/db/drizzle");
const LAST_GRANDFATHERED = 30;

const DESTRUCTIVE: ReadonlyArray<[string, RegExp]> = [
  ["DROP", /\bDROP\s+(TABLE|COLUMN|INDEX|CONSTRAINT|VIEW|SCHEMA|TYPE|SEQUENCE)\b/i],
  ["ALTER COLUMN ... TYPE", /\bALTER\s+COLUMN\s+\S+\s+(SET\s+DATA\s+)?TYPE\b/i],
  ["SET NOT NULL", /\bSET\s+NOT\s+NULL\b/i],
  ["RENAME", /\bRENAME\b/i],
  ["TRUNCATE", /\bTRUNCATE\b/i],
  ["DELETE FROM", /\bDELETE\s+FROM\b/i],
  // `ON UPDATE no action` у внешних ключей сюда не попадает: нет SET.
  ["UPDATE", /\bUPDATE\s+[\w."]+\s+SET\b/i],
];

/** Что в миграции разрушает данные или ломает старый код; пусто — можно. */
function destructiveStatements(sql: string): string[] {
  if (/^[ \t]*--[ \t]*allow-destructive:[ \t]*\S/m.test(sql)) return [];
  const code = sql.replace(/--.*$/gm, "");
  return DESTRUCTIVE.filter(([, re]) => re.test(code)).map(([name]) => name);
}

describe("destructiveStatements", () => {
  const cases: Array<[string, string, string[]]> = [
    ["add column", 'ALTER TABLE "clients" ADD COLUMN "category" text;', []],
    ["create table", 'CREATE TABLE IF NOT EXISTS "x" ("id" uuid PRIMARY KEY);', []],
    ["create index", 'CREATE INDEX "x_idx" ON "x" ("a");', []],
    [
      "foreign key with ON DELETE / ON UPDATE",
      'ALTER TABLE "a" ADD CONSTRAINT "a_fk" FOREIGN KEY ("b") REFERENCES "b"("id") ON DELETE cascade ON UPDATE no action;',
      [],
    ],
    ["drop default is a relaxation", 'ALTER TABLE "a" ALTER COLUMN "b" DROP DEFAULT;', []],
    ["drop not null is a relaxation", 'ALTER TABLE "a" ALTER COLUMN "b" DROP NOT NULL;', []],
    ["statement breakpoint comment", "--> statement-breakpoint\n", []],
    ["drop word only in a comment", "-- DROP TABLE x\nCREATE TABLE y ();", []],
    ["drop table", 'DROP TABLE "x";', ["DROP"]],
    ["drop column", 'ALTER TABLE "a" DROP COLUMN "b";', ["DROP"]],
    ["drop index", 'DROP INDEX IF EXISTS "x_idx";', ["DROP"]],
    ["drop constraint", 'ALTER TABLE "a" DROP CONSTRAINT "a_fk";', ["DROP"]],
    ["change type", 'ALTER TABLE "a" ALTER COLUMN "b" SET DATA TYPE integer;', ["ALTER COLUMN ... TYPE"]],
    ["change type short", 'ALTER TABLE "a" ALTER COLUMN "b" TYPE integer;', ["ALTER COLUMN ... TYPE"]],
    ["set not null", 'ALTER TABLE "a" ALTER COLUMN "b" SET NOT NULL;', ["SET NOT NULL"]],
    ["rename column", 'ALTER TABLE "a" RENAME COLUMN "b" TO "c";', ["RENAME"]],
    ["rename table", 'ALTER TABLE "a" RENAME TO "b";', ["RENAME"]],
    ["truncate", 'TRUNCATE "a";', ["TRUNCATE"]],
    ["delete", 'DELETE FROM "a" WHERE true;', ["DELETE FROM"]],
    ["update", 'UPDATE "a" SET "b" = 1;', ["UPDATE"]],
    ["lowercase", "drop table a;", ["DROP"]],
    ["escape hatch", "-- allow-destructive: колонка не читалась с 0012\nALTER TABLE a DROP COLUMN b;", []],
    ["empty escape hatch does not count", "-- allow-destructive:\nDROP TABLE a;", ["DROP"]],
  ];

  it.each(cases)("%s", (_name, sql, expected) => {
    expect(destructiveStatements(sql)).toEqual(expected);
  });
});

describe("migrations after 0030", () => {
  const files = readdirSync(MIGRATIONS).filter((f) => /^\d{4}_.*\.sql$/.test(f));

  it("finds the migration files", () => {
    expect(files.length).toBeGreaterThan(LAST_GRANDFATHERED);
  });

  it("the detector would have caught the old destructive ones", () => {
    const old = files.filter((f) => Number(f.slice(0, 4)) <= LAST_GRANDFATHERED);
    const flagged = old.filter(
      (f) => destructiveStatements(readFileSync(join(MIGRATIONS, f), "utf8")).length > 0,
    );
    expect(flagged.length).toBeGreaterThan(0);
  });

  it("are additive only", () => {
    const offenders = files
      .filter((f) => Number(f.slice(0, 4)) > LAST_GRANDFATHERED)
      .map((f) => [f, destructiveStatements(readFileSync(join(MIGRATIONS, f), "utf8"))] as const)
      .filter(([, found]) => found.length > 0)
      .map(([f, found]) => `${f}: ${found.join(", ")} (add "-- allow-destructive: <reason>" if intended)`);
    expect(offenders).toEqual([]);
  });
});
