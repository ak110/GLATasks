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
  index,
  customType,
} from "drizzle-orm/mysql-core";
import { TIMER_DEFAULT_ADJUST_MINUTES } from "$lib/schemas";

/** user テーブル */
export const users = mysqlTable("user", {
  id: int("id").primaryKey().autoincrement(),
  user: varchar("user", { length: 80 }).notNull().unique(),
  pass_hash: varchar("pass_hash", { length: 255 }).notNull(),
  joined: timestamp("joined").notNull(),
  last_login: timestamp("last_login"),
  // 利用者ごとの設定値を JSON 文字列で集約する。
  // 将来項目追加時にスキーマ変更を不要にするため単一カラムでまとめ、
  // 値の構造は zod の UserPreferencesSchema 側で保証する。
  preferences: mediumtext("preferences").notNull().default("{}"),
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
  // タスク区分（"normal" | "todo"）。既存タスクには "normal" が自動的に入る
  kind: varchar("kind", { length: 255 }).notNull().default("normal"),
  text: mediumtext("text").notNull(),
  // タグ配列のJSON文字列（要素は { name, color }）
  tags: mediumtext("tags").notNull().default("[]"),
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
  ephemeral: tinyint("ephemeral").notNull().default(0),
  // 期限切れ後に利用者が能動的に止めるまでビープを鳴らし続けるか。
  // 既定値は OFF（オプトイン）。タイマーごとに上書き可能。
  keep_ringing: tinyint("keep_ringing").notNull().default(0),
  remaining_seconds: int("remaining_seconds").notNull(),
  started_at: timestamp("started_at"),
  sort_order: int("sort_order").notNull().default(0),
  created: timestamp("created").notNull(),
  updated: timestamp("updated").notNull(),
});

// drizzle-orm 0.45.2 の mysql-core に mediumblob ビルダーが存在しないため、
// customType で MEDIUMBLOB 型を定義する。
const mediumblob = customType<{ data: Uint8Array; driverData: Buffer }>({
  dataType() {
    return "mediumblob";
  },
  toDriver(value) {
    return Buffer.from(value);
  },
  fromDriver(value) {
    return new Uint8Array(value);
  },
});

/** attachment テーブル */
export const attachments = mysqlTable(
  "attachment",
  {
    id: int("id").autoincrement().primaryKey(),
    task_id: int("task_id").notNull(),
    filename: varchar("filename", { length: 255 }).notNull(),
    mime_type: varchar("mime_type", { length: 255 }).notNull(),
    size: int("size").notNull(),
    data: mediumblob("data").notNull(),
    created: timestamp("created").notNull(),
  },
  (t) => ({
    task_id_idx: index("task_id_idx").on(t.task_id),
  }),
);

/** schedule テーブル（定期TODOの繰り返しルールを保持する） */
export const schedules = mysqlTable(
  "schedule",
  {
    id: int("id").primaryKey().autoincrement(),
    list_id: int("list_id").notNull(),
    title: varchar("title", { length: 255 }).notNull(),
    // タグ配列のJSON文字列（tasks.tags と同形式）
    tags: mediumtext("tags").notNull().default("[]"),
    // RFC5545形式のRRULE文字列（DTSTART;TZID=Asia/Tokyo:... と RRULE:FREQ=... を改行連結）
    rrule: mediumtext("rrule").notNull(),
    last_fired: timestamp("last_fired"),
    enabled: tinyint("enabled").notNull().default(1),
    sort_order: int("sort_order").notNull().default(0),
    created: timestamp("created").notNull(),
    updated: timestamp("updated").notNull(),
  },
  (t) => ({
    list_id_idx: index("list_id_idx").on(t.list_id),
  }),
);
