import {
  pgTable,
  text,
  varchar,
  timestamp,
  serial,
  integer,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

// Global game state (stores total rules etc.)
export const gameState = pgTable("game_state", {
  id: serial("id").primaryKey(),
  key: varchar("key").unique().notNull(),
  value: text("value").notNull(),
  updatedAt: timestamp("updated_at").defaultNow(),
});

// Drop mapping table for storing test results
export const dropMapping = pgTable("drop_mapping", {
  id: serial("id").primaryKey(),
  dropX: integer("drop_x").notNull(),
  boxNumber: integer("box_number").notNull(),
  testRunId: varchar("test_run_id", { length: 255 }).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Test runs tracking table
export const testRuns = pgTable("test_runs", {
  id: serial("id").primaryKey(),
  testRunId: varchar("test_run_id", { length: 255 }).notNull().unique(),
  totalMappings: integer("total_mappings").notNull(),
  completedAt: timestamp("completed_at").defaultNow().notNull(),
  status: varchar("status", { length: 50 }).default("completed").notNull(),
});

// Insert schemas
export const insertGameStateSchema = createInsertSchema(gameState);
export const insertDropMappingSchema = createInsertSchema(dropMapping);
export const insertTestRunSchema = createInsertSchema(testRuns);

// Types
export type GameState = typeof gameState.$inferSelect;
export type DropMapping = typeof dropMapping.$inferSelect;
export type TestRun = typeof testRuns.$inferSelect;
