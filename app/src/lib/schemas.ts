/**
 * @fileoverview Zod バリデーションスキーマ定義と型エクスポート
 *
 * `TagInfo`・`TAG_COLOR_KEYS`・`TagColorKey` はここを正とし、`types.ts` はre-exportのみ行う。
 */

import { z } from "zod";

// ── タグ色相定数 ──

/** 利用可能な色相キー。色覚特性の差があっても区別しやすい配色。 */
export const TAG_COLOR_KEYS = [
  "amber",
  "sky",
  "emerald",
  "yellow",
  "blue",
  "red",
  "pink",
  "slate",
] as const;

/** タグの色相キー型 */
export type TagColorKey = (typeof TAG_COLOR_KEYS)[number];

// ── 共通スキーマ ──

export const TaskStatusSchema = z.enum([
  "active",
  "running",
  "completed",
  "archived",
]);
export const ShowTypeSchema = z.enum(["active", "archived", "all"]);
export const ListStatusSchema = z.enum(["active", "archived"]);

/** タスク区分。"todo" は通知バッジ集計・定期TODO発火の対象となる。 */
export const TaskKindSchema = z.enum(["normal", "todo"]);
export type TaskKind = z.infer<typeof TaskKindSchema>;

// ── タグスキーマ ──

/** タスクに付与する個別タグ */
export const TagInfoSchema = z.object({
  name: z.string().trim().min(1).max(40),
  color: z.enum(TAG_COLOR_KEYS),
});

/** タスクに付与するタグ配列（同一タスク内での上限は32個） */
export const TagsSchema = z.array(TagInfoSchema).max(32);

// ── 検索スキーマ ──

export const SearchTasksSchema = z.object({
  query: z.string().min(1).max(255),
  showType: ShowTypeSchema.default("active"),
});

// ── タスク操作スキーマ ──

/**
 * タスク本文の最大バイト数（UTF-8）。
 * DBカラム（mediumtext、最大16,777,215バイト）に安全余裕を残した値とする。
 */
export const MAX_TASK_TEXT_BYTES = 16_000_000;

const taskTextEncoder = new TextEncoder();

function isWithinMaxTaskTextBytes(text: string): boolean {
  return taskTextEncoder.encode(text).length <= MAX_TASK_TEXT_BYTES;
}

const taskTextTooLongMessage = `タスク内容は${MAX_TASK_TEXT_BYTES.toLocaleString("ja-JP")}バイト以下にしてください`;

export const CreateTaskSchema = z.object({
  listId: z.number().int().positive(),
  text: z
    .string()
    .min(1, "タスク内容は必須です")
    .refine(isWithinMaxTaskTextBytes, taskTextTooLongMessage),
  tags: TagsSchema.optional(),
  kind: TaskKindSchema.optional(),
});

export const UpdateTaskSchema = z
  .object({
    listId: z.number().int().positive(),
    taskId: z.number().int().positive(),
    text: z
      .string()
      .refine(isWithinMaxTaskTextBytes, taskTextTooLongMessage)
      .optional(),
    status: TaskStatusSchema.optional(),
    completed: z.string().datetime().nullable().optional(),
    moveTo: z.number().int().positive().optional(),
    keepOrder: z.boolean().default(false),
    tags: TagsSchema.optional(),
    kind: TaskKindSchema.optional(),
  })
  .refine(
    (data) =>
      data.text !== undefined ||
      data.status !== undefined ||
      data.moveTo !== undefined ||
      data.tags !== undefined ||
      data.kind !== undefined,
    { message: "更新する項目が指定されていません" },
  );

// ── リスト操作スキーマ ──

export const CreateListSchema = z.object({
  title: z.string().min(1, "タイトルは必須です").max(255),
});

export const UpdateListSchema = z.object({
  listId: z.number().int().positive(),
  title: z.string().min(1, "タイトルは必須です").max(255),
});

export const GetListTasksSchema = z.object({
  listId: z.number().int().positive(),
  showType: ShowTypeSchema,
  ifModifiedSince: z.string().datetime().optional(),
});

// ── タイマーデフォルト値 ──

/** タイマー作成時のベース時間デフォルト（分） */
export const TIMER_DEFAULT_BASE_MINUTES = 30;

/** 延長/削減のデフォルト分数 */
export const TIMER_DEFAULT_ADJUST_MINUTES = 10;

/**
 * ビープを鳴らす秒数のデフォルト値。
 * 上限3600秒はユーザーフィードバックで提示された値、
 * 既定値3秒は従来のオプトインOFF時の鳴動時間（実測約2.8秒）とほぼ同じ長さになるよう選定した。
 */
export const TIMER_DEFAULT_RING_SECONDS = 3;

/** タイマーモード */
export const TIMER_MODES = ["countdown", "alarm"] as const;
export const TimerModeSchema = z.enum(TIMER_MODES);
export type TimerMode = z.infer<typeof TimerModeSchema>;

/** タイマー系で共有する入力範囲。 */
export const TimezoneOffsetSchema = z.number().int().min(-720).max(840);
export const TimerSecondsSchema = z.number().int().min(0).max(359999);
export const TimerRingSecondsSchema = z.number().int().min(1).max(3600);
export const TimerAdjustMinutesSchema = z.number().int().min(1).max(999);

// ── 利用者デフォルト値スキーマ ──

/**
 * 新規タイマー作成時の既定値（利用者ごと）。
 * 各フィールドはオプショナル。欠落時はコード側のフォールバック定数で補う。
 */
export const UserPreferencesSchema = z.object({
  ringSeconds: TimerRingSecondsSchema.optional(),
  baseSeconds: TimerSecondsSchema.optional(),
  adjustMinutes: TimerAdjustMinutesSchema.optional(),
  mode: TimerModeSchema.optional(),
  calorieGoalKcal: z.number().int().positive().max(1_000_000).optional(),
});
export type UserPreferences = z.infer<typeof UserPreferencesSchema>;

// ── カロリー計算スキーマ ──

export const DEFAULT_CALORIE_GOAL_KCAL = 1615;
export const MAX_CALORIE_CSV_ROWS = 10_000;

const PositiveCalorieIntegerSchema = z.number().int().positive().max(1_000_000);
const NonNegativeCalorieIntegerSchema = z.number().int().min(0).max(1_000_000);

/** 年月日・時分がそのまま実在する日時を表すかを返す（2月30日や25時を拒否する） */
function isRealDateTime(
  year: number,
  month: number,
  day: number,
  hour = 0,
  minute = 0,
): boolean {
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day &&
    date.getUTCHours() === hour &&
    date.getUTCMinutes() === minute
  );
}

const LocalMinuteSchema = z
  .string()
  .regex(
    /^\d{4}\/\d{2}\/\d{2} \d{2}:\d{2}$/,
    "日時はyyyy/MM/dd HH:mm形式で入力してください",
  )
  .refine((value) => {
    const [datePart, timePart] = value.split(" ");
    const [year, month, day] = datePart.split("/").map(Number);
    const [hour, minute] = timePart.split(":").map(Number);
    return isRealDateTime(year, month, day, hour, minute);
  }, "実在する日時を入力してください");
const LocalDateSchema = z
  .string()
  .regex(/^\d{4}\/\d{2}\/\d{2}$/, "日付はyyyy/MM/dd形式で入力してください")
  .refine((value) => {
    const [year, month, day] = value.split("/").map(Number);
    return isRealDateTime(year, month, day);
  }, "実在する日付を入力してください");
const LocalTimeSchema = z
  .string()
  .regex(/^\d{2}:\d{2}$/, "時刻はHH:mm形式で入力してください")
  .refine((value) => {
    const [hour, minute] = value.split(":").map(Number);
    return hour < 24 && minute < 60;
  }, "実在する時刻を入力してください");

export const CreateCalorieItemSchema = z.object({
  name: z.string().trim().min(1, "品目名は必須です").max(255),
  kcal: PositiveCalorieIntegerSchema,
  note: z.string().max(10_000).default(""),
});

export const UpdateCalorieItemSchema = CreateCalorieItemSchema.extend({
  itemId: z.number().int().positive(),
});

export const CalorieItemIdSchema = z.object({
  itemId: z.number().int().positive(),
});

/**
 * 記録の入力項目。品目の記録は`itemId`を、品目表へ登録しない一時項目の記録は
 * `temporaryName`を、どちらか一方だけ指定する。一時項目の`quantity`はkcalとして扱う
 */
const CalorieRecordFieldsSchema = z.object({
  consumedAt: LocalMinuteSchema,
  itemId: z.number().int().positive().optional(),
  temporaryName: z.string().trim().min(1).max(255).optional(),
  quantity: NonNegativeCalorieIntegerSchema,
  tzOffsetMinutes: TimezoneOffsetSchema,
});

function hasItemOrTemporaryName(data: {
  itemId?: number;
  temporaryName?: string;
}): boolean {
  return (data.itemId === undefined) !== (data.temporaryName === undefined);
}

const itemOrTemporaryNameMessage = {
  message: "品目か一時項目名のどちらか一方を指定してください",
};

export const CreateCalorieRecordSchema = CalorieRecordFieldsSchema.refine(
  hasItemOrTemporaryName,
  itemOrTemporaryNameMessage,
);

export const UpdateCalorieRecordSchema = CalorieRecordFieldsSchema.extend({
  recordId: z.number().int().positive(),
}).refine(hasItemOrTemporaryName, itemOrTemporaryNameMessage);

export const CalorieRecordIdSchema = z.object({
  recordId: z.number().int().positive(),
});

export const ListCalorieRecordsSchema = z.object({
  windowOffset: z.number().int().min(0).max(120).default(0),
  tzOffsetMinutes: TimezoneOffsetSchema,
});

export const GetCalorieSummarySchema = z.object({
  tzOffsetMinutes: TimezoneOffsetSchema,
});

export const CalorieItemCsvRowSchema = z.object({
  name: z.string().min(1, "品目名は必須です").max(255),
  kcal: PositiveCalorieIntegerSchema,
  note: z.string().max(10_000).default(""),
});
export const CalorieRecordCsvRowSchema = z.object({
  consumed_at: LocalMinuteSchema,
  item_name: z.string().min(1).max(255),
  quantity: NonNegativeCalorieIntegerSchema,
  // 一時項目の行は品目表と照合せず、quantityをkcalとして取り込む
  temporary: z.boolean().default(false),
});

export const ImportCalorieItemsSchema = z.object({
  rows: z.array(CalorieItemCsvRowSchema).max(MAX_CALORIE_CSV_ROWS),
});

export const ImportCalorieRecordsSchema = z.object({
  rows: z.array(CalorieRecordCsvRowSchema).max(MAX_CALORIE_CSV_ROWS),
  tzOffsetMinutes: TimezoneOffsetSchema,
});

export const BulkCreateCalorieRecordsSchema = z.object({
  startDate: LocalDateSchema,
  endDate: LocalDateSchema,
  timeOfDay: LocalTimeSchema,
  itemId: z.number().int().positive(),
  quantity: NonNegativeCalorieIntegerSchema,
  tzOffsetMinutes: TimezoneOffsetSchema,
});

export const BulkDeleteCalorieRecordsSchema = z.object({
  startDate: LocalDateSchema,
  endDate: LocalDateSchema,
  itemId: z.number().int().positive(),
  tzOffsetMinutes: TimezoneOffsetSchema,
});

export const CreateCalorieAutoRecordSchema = z.object({
  timeOfDay: LocalTimeSchema,
  itemId: z.number().int().positive(),
  quantity: NonNegativeCalorieIntegerSchema,
  enabled: z.boolean(),
  tzOffsetMinutes: TimezoneOffsetSchema,
});

export const UpdateCalorieAutoRecordSchema =
  CreateCalorieAutoRecordSchema.extend({
    autoRecordId: z.number().int().positive(),
  });

export const CalorieAutoRecordIdSchema = z.object({
  autoRecordId: z.number().int().positive(),
});

// ── タイマー操作スキーマ ──

export const CreateTimerSchema = z
  .object({
    name: z.string().trim().max(255),
    mode: TimerModeSchema.default("countdown"),
    baseSeconds: TimerSecondsSchema,
    targetMinutes: z.number().int().min(0).max(1439).optional(),
    tzOffsetMinutes: TimezoneOffsetSchema.optional(),
    adjustMinutes: TimerAdjustMinutesSchema.default(
      TIMER_DEFAULT_ADJUST_MINUTES,
    ),
    // 1回限りのタイマー。満了時に削除ボタンを強調し、確認ダイアログを省略する
    ephemeral: z.boolean().default(false),
    // 期限切れ後にビープを鳴らす秒数（上限・既定値の根拠は TIMER_DEFAULT_RING_SECONDS のコメントを参照）
    ringSeconds: TimerRingSecondsSchema.default(TIMER_DEFAULT_RING_SECONDS),
  })
  .refine(
    (data) =>
      data.mode !== "alarm" ||
      (data.targetMinutes !== undefined && data.tzOffsetMinutes !== undefined),
    { message: "アラームモードでは目標時刻とタイムゾーンオフセットが必須です" },
  );

export const UpdateTimerSchema = z
  .object({
    timerId: z.number().int().positive(),
    name: z.string().trim().max(255).optional(),
    mode: TimerModeSchema.optional(),
    baseSeconds: TimerSecondsSchema.optional(),
    targetMinutes: z.number().int().min(0).max(1439).optional(),
    tzOffsetMinutes: TimezoneOffsetSchema.optional(),
    adjustMinutes: TimerAdjustMinutesSchema.optional(),
    ringSeconds: TimerRingSecondsSchema.optional(),
  })
  .refine(
    (data) =>
      data.mode !== "alarm" ||
      (data.targetMinutes !== undefined && data.tzOffsetMinutes !== undefined),
    { message: "アラームモードでは目標時刻とタイムゾーンオフセットが必須です" },
  )
  .refine(
    (data) =>
      data.mode !== "countdown" ||
      data.baseSeconds !== undefined ||
      data.mode === undefined,
    { message: "カウントダウンモードではベース時間が必須です" },
  );

export const TimerIdSchema = z.object({
  timerId: z.number().int().positive(),
});

export const StartTimerSchema = z.object({
  timerId: z.number().int().positive(),
  tzOffsetMinutes: TimezoneOffsetSchema.optional(),
});

export const ResetTimerSchema = z.object({
  timerId: z.number().int().positive(),
  tzOffsetMinutes: TimezoneOffsetSchema.optional(),
});

export const TimerStopSchema = z.object({
  timerId: z.number().int().positive(),
  // アラーム発火時の startedAt。リセット/再開されていないことを確認するために使用
  startedAt: z.string().datetime().nullable().optional(),
});

export const AdjustTimerSchema = z.object({
  timerId: z.number().int().positive(),
  minutes: z.number().int(),
});

export const SetTimerTimeSchema = z.object({
  timerId: z.number().int().positive(),
  seconds: TimerSecondsSchema,
  targetMinutes: z.number().int().min(0).max(1439).optional(),
  tzOffsetMinutes: TimezoneOffsetSchema.optional(),
});

// ── 認証スキーマ ──

export const RegisterUserSchema = z.object({
  userId: z
    .string()
    .regex(
      /^[a-zA-Z0-9]{4,32}$/,
      "ユーザーIDは4～32文字の英数字としてください",
    ),
  password: z.string().min(1, "パスワードは必須です"),
});

// ── 差分syncスキーマ ──

/** 全アクティブタスク取得（差分 sync 対応）の入力スキーマ */
export const GetActiveTasksSchema = z.object({
  since: z.string().datetime().optional(),
});

// ── リスト統合スキーマ ──

export const MergeListSchema = z.object({
  sourceListId: z.number().int().positive(),
  targetListId: z.number().int().positive(),
});

// ── 並び替えスキーマ ──

export const ReorderTasksSchema = z.object({
  listId: z.number().int().positive(),
  taskIds: z
    .array(z.number().int().positive())
    .refine(
      (ids) => new Set(ids).size === ids.length,
      "タスクIDが重複しています",
    ),
});

export const ReorderTimersSchema = z.object({
  timerIds: z
    .array(z.number().int().positive())
    .refine(
      (ids) => new Set(ids).size === ids.length,
      "タイマーIDが重複しています",
    ),
});

// ── 添付スキーマ ──

export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_TASK = 99;
export const MAX_ATTACHMENT_BASE64_LENGTH =
  Math.ceil((MAX_ATTACHMENT_BYTES * 4) / 3) + 32;

export const CreateAttachmentSchema = z.object({
  taskId: z.number().int().positive(),
  filename: z.string().min(1).max(255),
  mimeType: z.string().max(255),
  data: z.string().max(MAX_ATTACHMENT_BASE64_LENGTH),
});

export const DeleteAttachmentSchema = z.object({
  attachmentId: z.number().int().positive(),
});

export const DownloadAttachmentSchema = z.object({
  attachmentId: z.number().int().positive(),
});

// ── 型エクスポート ──

export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type ShowType = z.infer<typeof ShowTypeSchema>;
/** タグ情報型（`TagInfoSchema` からの推論） */
export type TagInfo = z.infer<typeof TagInfoSchema>;

export type CalorieItemInput = z.infer<typeof CreateCalorieItemSchema>;
export type UpdateCalorieItemInput = z.infer<typeof UpdateCalorieItemSchema>;
export type CalorieRecordInput = z.infer<typeof CreateCalorieRecordSchema>;
export type UpdateCalorieRecordInput = z.infer<
  typeof UpdateCalorieRecordSchema
>;
export type ListCalorieRecordsInput = z.infer<typeof ListCalorieRecordsSchema>;
export type CalorieItemCsvRow = z.infer<typeof CalorieItemCsvRowSchema>;
export type CalorieRecordCsvRow = z.infer<typeof CalorieRecordCsvRowSchema>;
export type BulkCreateCalorieRecordsInput = z.infer<
  typeof BulkCreateCalorieRecordsSchema
>;
export type BulkDeleteCalorieRecordsInput = z.infer<
  typeof BulkDeleteCalorieRecordsSchema
>;
export type CalorieAutoRecordInput = z.infer<
  typeof CreateCalorieAutoRecordSchema
>;
export type UpdateCalorieAutoRecordInput = z.infer<
  typeof UpdateCalorieAutoRecordSchema
>;
