import { sql } from "drizzle-orm";
import { check, index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const groups = sqliteTable("groups", {
  id: integer("id").primaryKey(),
  code: text("code").notNull().unique(),
  eiosUrl: text("eios_url").notNull(),
});

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull(),
  displayName: text("display_name").notNull(),
  groupId: integer("group_id").references(() => groups.id),
  role: text("role", { enum: ["student", "group_admin", "super_admin"] }).notNull().default("student"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [
  index("idx_users_group_id").on(table.groupId),
  index("idx_users_role").on(table.role),
  uniqueIndex("uq_users_single_super_admin").on(table.role).where(sql`${table.role} = 'super_admin'`),
  check("users_role_check", sql`${table.role} IN ('student', 'group_admin', 'super_admin')`),
]);

export const adminClaimAttempts = sqliteTable("admin_claim_attempts", {
  userId: text("user_id").primaryKey().references(() => users.id),
  attempts: integer("attempts").notNull().default(0),
  lockedUntil: text("locked_until"),
  updatedAt: text("updated_at").notNull(),
});

export const homework = sqliteTable("homework", {
  id: text("id").primaryKey(),
  groupId: integer("group_id").notNull().references(() => groups.id),
  subject: text("subject").notNull(),
  title: text("title").notNull(),
  details: text("details").notNull().default(""),
  due: text("due").notNull(),
  done: integer("done", { mode: "boolean" }).notNull().default(false),
  createdBy: text("created_by").notNull().references(() => users.id),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [index("idx_homework_group_due").on(table.groupId, table.due)]);

export const events = sqliteTable("events", {
  id: text("id").primaryKey(),
  groupId: integer("group_id").notNull().references(() => groups.id),
  title: text("title").notNull(),
  details: text("details").notNull().default(""),
  date: text("date").notNull(),
  time: text("time").notNull().default(""),
  createdBy: text("created_by").notNull().references(() => users.id),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, (table) => [index("idx_events_group_date").on(table.groupId, table.date)]);
