import {
  mysqlTable,
  int,
  varchar,
  mediumtext,
  timestamp,
  tinyint,
  index,
  uniqueIndex,
  customType,
  bigint,
} from "drizzle-orm/mysql-core";
import {
  TIMER_DEFAULT_ADJUST_MINUTES,
  TIMER_DEFAULT_RING_SECONDS,
  ListStatusSchema,
  TaskStatusSchema,
  TaskKindSchema,
  TimerModeSchema,
} from "#lib/schemas.ts";

export const users = mysqlTable("user", {
  id: int("id").primaryKey().autoincrement(),
  user: varchar("user", { length: 80 }).notNull().unique(),
  pass_hash: varchar("pass_hash", { length: 255 }),
  session_generation: int("session_generation").notNull().default(0),
  webauthn_handle: varchar("webauthn_handle", { length: 64 }),
  recovery_failures: int("recovery_failures").notNull().default(0),
  recovery_locked_until: timestamp("recovery_locked_until"),
  joined: timestamp("joined").notNull(),
  last_login: timestamp("last_login"),
  preferences: mediumtext("preferences").notNull().default("{}"),
});

const credentialId = customType<{ data: string }>({
  dataType: () => "varchar(1400) CHARACTER SET ascii COLLATE ascii_bin",
});
export const passkeys = mysqlTable("passkey", {
  id: credentialId("id").primaryKey(),
  user_id: int("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  public_key: mediumtext("public_key").notNull(),
  counter: bigint("counter", { mode: "number", unsigned: true }).notNull(),
  transports: varchar("transports", { length: 255 }).notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  created: timestamp("created").notNull(),
  last_used: timestamp("last_used"),
});

export const recoveryCodes = mysqlTable("recovery_code", {
  id: int("id").primaryKey().autoincrement(),
  user_id: int("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  digest: varchar("digest", { length: 64 }).notNull(),
  used: timestamp("used"),
  created: timestamp("created").notNull(),
});

export const authChallenges = mysqlTable(
  "auth_challenge",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    purpose: varchar("purpose", { length: 32 }).notNull(),
    user_id: int("user_id"),
    user_name: varchar("user_name", { length: 80 }),
    handle: varchar("handle", { length: 64 }),
    generation: int("generation").notNull().default(0),
    challenge: varchar("challenge", { length: 128 }).notNull(),
    data: mediumtext("data").notNull().default("{}"),
    expires: timestamp("expires").notNull(),
    consumed: timestamp("consumed"),
  },
  (t) => ({ expires_idx: index("auth_challenge_expires_idx").on(t.expires) }),
);

export const calorieItems = mysqlTable(
  "calorie_item",
  {
    id: int("id").primaryKey().autoincrement(),
    user_id: int("user_id").notNull(),
    name: varchar("name", { length: 255 }).notNull(),
    kcal: int("kcal").notNull(),
    note: mediumtext("note").notNull().default(""),
    created: timestamp("created").notNull(),
    updated: timestamp("updated").notNull(),
  },
  (t) => ({
    user_name_unique: uniqueIndex("calorie_item_user_name_unique").on(
      t.user_id,
      t.name,
    ),
  }),
);

/**
 * カロリー計算の摂取記録テーブル
 *
 * 品目を参照する記録と、品目表へ登録せず名前を記録自身が持つ一時項目の記録がある。
 * 一時項目は`quantity`をkcalとして扱い、品目のkcalと掛け算しない。
 * `item_id`と`temporary_name`はどちらか一方だけを持つ。MariaDBはON UPDATE CASCADEの
 * 外部キー列をCHECK制約に使えない（ERROR 1901）ため、この不変条件は書き込み側で守る。
 */
export const calorieRecords = mysqlTable(
  "calorie_record",
  {
    id: int("id").primaryKey().autoincrement(),
    user_id: int("user_id").notNull(),
    item_id: int("item_id").references(() => calorieItems.id, {
      onDelete: "restrict",
      onUpdate: "cascade",
    }),
    temporary_name: varchar("temporary_name", { length: 255 }),
    consumed_at: timestamp("consumed_at").notNull(),
    quantity: int("quantity").notNull(),
    created: timestamp("created").notNull(),
    updated: timestamp("updated").notNull(),
  },
  (t) => ({
    user_consumed_id_idx: index("calorie_record_user_consumed_id_idx").on(
      t.user_id,
      t.consumed_at,
      t.id,
    ),
  }),
);

export const calorieAutoRecords = mysqlTable(
  "calorie_auto_record",
  {
    id: int("id").primaryKey().autoincrement(),
    user_id: int("user_id").notNull(),
    item_id: int("item_id")
      .notNull()
      .references(() => calorieItems.id, {
        onDelete: "restrict",
        onUpdate: "cascade",
      }),
    time_of_day: varchar("time_of_day", { length: 5 }).notNull(),
    quantity: int("quantity").notNull(),
    enabled: tinyint("enabled").notNull().default(1),
    tz_offset_minutes: int("tz_offset_minutes").notNull(),
    next_run_at: timestamp("next_run_at").notNull(),
    created: timestamp("created").notNull(),
    updated: timestamp("updated").notNull(),
  },
  (t) => ({
    user_id_idx: index("calorie_auto_record_user_id_idx").on(t.user_id),
  }),
);

export const lists = mysqlTable(
  "list",
  {
    id: int("id").primaryKey().autoincrement(),
    user_id: int("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    status: varchar("status", {
      length: 255,
      enum: [ListStatusSchema.enum.active, ListStatusSchema.enum.archived],
    })
      .notNull()
      .default("active"),
    title: varchar("title", { length: 255 }).notNull(),
    sort_order: int("sort_order").notNull().default(0),
    last_updated: timestamp("last_updated").notNull(),
  },
  (t) => ({ user_id_idx: index("user_id_idx").on(t.user_id) }),
);

export const tasks = mysqlTable(
  "task",
  {
    id: int("id").primaryKey().autoincrement(),
    list_id: int("list_id")
      .notNull()
      .references(() => lists.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    status: varchar("status", {
      length: 255,
      enum: [
        TaskStatusSchema.enum.active,
        TaskStatusSchema.enum.running,
        TaskStatusSchema.enum.completed,
        TaskStatusSchema.enum.archived,
      ],
    })
      .notNull()
      .default("active"),
    kind: varchar("kind", {
      length: 255,
      enum: [TaskKindSchema.enum.normal, TaskKindSchema.enum.todo],
    })
      .notNull()
      .default("normal"),
    text: mediumtext("text").notNull(),
    tags: mediumtext("tags").notNull().default("[]"),
    sort_order: int("sort_order").notNull().default(0),
    created: timestamp("created").notNull(),
    updated: timestamp("updated").notNull(),
    completed: timestamp("completed"),
  },
  (t) => ({ list_id_idx: index("list_id_idx").on(t.list_id) }),
);

export const timers = mysqlTable(
  "timer",
  {
    id: int("id").primaryKey().autoincrement(),
    user_id: int("user_id")
      .notNull()
      .references(() => users.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    name: varchar("name", { length: 255 }).notNull(),
    mode: varchar("mode", {
      length: 10,
      enum: [TimerModeSchema.enum.countdown, TimerModeSchema.enum.alarm],
    })
      .notNull()
      .default("countdown"),
    target_minutes: int("target_minutes"),
    base_seconds: int("base_seconds").notNull(),
    adjust_minutes: int("adjust_minutes")
      .notNull()
      .default(TIMER_DEFAULT_ADJUST_MINUTES),
    running: tinyint("running").notNull().default(0),
    expired: tinyint("expired").notNull().default(0),
    ephemeral: tinyint("ephemeral").notNull().default(0),
    ring_seconds: int("ring_seconds")
      .notNull()
      .default(TIMER_DEFAULT_RING_SECONDS),
    remaining_seconds: int("remaining_seconds").notNull(),
    started_at: timestamp("started_at"),
    sort_order: int("sort_order").notNull().default(0),
    created: timestamp("created").notNull(),
    updated: timestamp("updated").notNull(),
  },
  (t) => ({ user_id_idx: index("user_id_idx").on(t.user_id) }),
);

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

export const attachments = mysqlTable(
  "attachment",
  {
    id: int("id").autoincrement().primaryKey(),
    task_id: int("task_id")
      .notNull()
      .references(() => tasks.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
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

export const schedules = mysqlTable(
  "schedule",
  {
    id: int("id").primaryKey().autoincrement(),
    list_id: int("list_id")
      .notNull()
      .references(() => lists.id, {
        onDelete: "restrict",
        onUpdate: "restrict",
      }),
    title: varchar("title", { length: 255 }).notNull(),
    tags: mediumtext("tags").notNull().default("[]"),
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
