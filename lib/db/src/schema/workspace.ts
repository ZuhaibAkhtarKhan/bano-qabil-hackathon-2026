import {
  integer,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export const opportunitiesTable = pgTable("opportunities", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull(),
  company: text("company").notNull(),
  role: text("role").notNull(),
  source: text("source").notNull().default("Manual save"),
  fit: integer("fit").notNull().default(0),
  deadline: text("deadline"),
  stage: text("stage").notNull().default("Saved"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const applicationsTable = pgTable("applications", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull(),
  company: text("company").notNull(),
  role: text("role").notNull(),
  stage: text("stage").notNull().default("Draft"),
  fit: integer("fit").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const documentsTable = pgTable("documents", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: text("user_id").notNull(),
  title: text("title").notNull(),
  kind: text("kind").notNull().default("Supporting material"),
  version: text("version").notNull().default("Version 1"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const applicationMemoryTable = pgTable(
  "application_memory",
  {
    userId: text("user_id").notNull(),
    summary: text("summary").notNull().default(""),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [primaryKey({ columns: [table.userId] })],
);