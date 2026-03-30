/**
 * @fileoverview Drizzle ORM スキーマ定義（既存 MariaDB テーブルに準拠）
 */

import {
  mysqlTable,
  int,
  varchar,
  mediumtext,
  timestamp,
  tinyint,
} from "drizzle-orm/mysql-core";
import { TIMER_DEFAULT_ADJUST_MINUTES } from "$lib/schemas";

/** user テーブル */
export const users = mysqlTable("user", {
  id: int("id").primaryKey().autoincrement(),
  user: varchar("user", { length: 80 }).notNull().unique(),
  pass_hash: varchar("pass_hash", { length: 255 }).notNull(),
  joined: timestamp("joined").notNull(),
  last_login: timestamp("last_login"),
});

/** list テーブル */
export const lists = mysqlTable("list", {
  id: int("id").primaryKey().autoincrement(),
  user_id: int("user_id").notNull(),
  status: varchar("status", { length: 255 }).notNull().default("active"),
  title: varchar("title", { length: 255 }).notNull(),
  sort_order: int("sort_order").notNull().default(0),
  last_updated: timestamp("last_updated").notNull(),
});

/** task テーブル */
export const tasks = mysqlTable("task", {
  id: int("id").primaryKey().autoincrement(),
  list_id: int("list_id").notNull(),
  status: varchar("status", { length: 255 }).notNull().default("active"),
  text: mediumtext("text").notNull(),
  sort_order: int("sort_order").notNull().default(0),
  created: timestamp("created").notNull(),
  updated: timestamp("updated").notNull(),
  completed: timestamp("completed"),
});

/** timer テーブル */
export const timers = mysqlTable("timer", {
  id: int("id").primaryKey().autoincrement(),
  user_id: int("user_id").notNull(),
  name: varchar("name", { length: 255 }).notNull(),
  mode: varchar("mode", { length: 10 }).notNull().default("countdown"),
  target_minutes: int("target_minutes"),
  base_seconds: int("base_seconds").notNull(),
  adjust_minutes: int("adjust_minutes")
    .notNull()
    .default(TIMER_DEFAULT_ADJUST_MINUTES),
  running: tinyint("running").notNull().default(0),
  expired: tinyint("expired").notNull().default(0),
  remaining_seconds: int("remaining_seconds").notNull(),
  started_at: timestamp("started_at"),
  sort_order: int("sort_order").notNull().default(0),
  created: timestamp("created").notNull(),
  updated: timestamp("updated").notNull(),
});
