import { relations } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const planEnum = pgEnum("plan", ["starter", "growth", "scale"]);
export const userRoleEnum = pgEnum("user_role", ["owner", "admin", "member"]);
export const clientStatusEnum = pgEnum("client_status", ["active", "paused", "prospect"]);

/** Тенант. Всё остальное принадлежит агентству прямо или через клиента (CLAUDE.md, инвариант 1). */
export const agencies = pgTable("agencies", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  logoUrl: text("logo_url"),
  brandColor: text("brand_color").notNull().default("#4f46e5"),
  plan: planEnum("plan").notNull().default("starter"),
  clientLimit: integer("client_limit").notNull().default(3),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable(
  "users",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    email: text("email").notNull().unique(),
    name: text("name").notNull(),
    role: userRoleEnum("role").notNull().default("member"),
    // Поля ниже требует Better Auth (таблица users выступает его user-моделью).
    emailVerified: boolean("email_verified").notNull().default(false),
    image: text("image"),
    /**
     * Когда участника убрали из агентства. Строка не удаляется — по ней
     * живут авторство действий и журнал, — но войти он больше не может.
     */
    deactivatedAt: timestamp("deactivated_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("users_agency_id_idx").on(table.agencyId)],
);

export const clients = pgTable(
  "clients",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    agencyId: uuid("agency_id")
      .notNull()
      .references(() => agencies.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    domain: text("domain").notNull(),
    industry: text("industry"),
    /**
     * Категория из списка CLIENT_CATEGORIES (@repo/core) — для общего индекса
     * источников. Пусто — клиент в индекс не попадает.
     */
    category: text("category"),
    /** Варианты написания бренда клиента — используются при матчинге упоминаний (T18). */
    brandNames: text("brand_names").array().notNull().default([]),
    competitorNames: text("competitor_names").array().notNull().default([]),
    status: clientStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [index("clients_agency_id_idx").on(table.agencyId)],
);

export const agenciesRelations = relations(agencies, ({ many }) => ({
  users: many(users),
  clients: many(clients),
}));

export const usersRelations = relations(users, ({ one }) => ({
  agency: one(agencies, { fields: [users.agencyId], references: [agencies.id] }),
}));

export const clientsRelations = relations(clients, ({ one }) => ({
  agency: one(agencies, { fields: [clients.agencyId], references: [agencies.id] }),
}));

export type Agency = typeof agencies.$inferSelect;
export type NewAgency = typeof agencies.$inferInsert;
export type User = typeof users.$inferSelect;
export type NewUser = typeof users.$inferInsert;
export type Client = typeof clients.$inferSelect;
export type NewClient = typeof clients.$inferInsert;
