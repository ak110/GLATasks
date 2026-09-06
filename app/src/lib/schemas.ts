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

export const CreateTaskSchema = z.object({
  listId: z.number().int().positive(),
  text: z.string().min(1, "タスク内容は必須です").max(100000),
  tags: TagsSchema.optional(),
  kind: TaskKindSchema.optional(),
});

export const UpdateTaskSchema = z
  .object({
    listId: z.number().int().positive(),
    taskId: z.number().int().positive(),
    text: z.string().max(100000).optional(),
    status: TaskStatusSchema.optional(),
    completed: z.string().datetime().nullable().optional(),
    move_to: z.number().int().positive().optional(),
    keep_order: z.boolean().default(false),
    tags: TagsSchema.optional(),
    kind: TaskKindSchema.optional(),
  })
  .refine(
    (data) =>
      data.text !== undefined ||
      data.status !== undefined ||
      data.move_to !== undefined ||
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

// ── 利用者デフォルト値スキーマ ──

/**
 * 新規タイマー作成時の既定値（利用者ごと）。
 * 各フィールドはオプショナル。欠落時はコード側のフォールバック定数で補う。
 */
export const UserPreferencesSchema = z.object({
  ring_seconds: z.number().int().min(1).max(3600).optional(),
  base_seconds: z.number().int().min(0).max(359999).optional(),
  adjust_minutes: z.number().int().min(1).max(999).optional(),
  mode: TimerModeSchema.optional(),
  calorie_goal_kcal: z.number().int().positive().max(1_000_000).optional(),
});
export type UserPreferences = z.infer<typeof UserPreferencesSchema>;

// ── カロリー計算スキーマ ──

export const DEFAULT_CALORIE_GOAL_KCAL = 1615;
export const MAX_CALORIE_CSV_ROWS = 10_000;

const PositiveCalorieIntegerSchema = z.number().int().positive().max(1_000_000);
const NonNegativeCalorieIntegerSchema = z.number().int().min(0).max(1_000_000);
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
    const date = new Date(Date.UTC(year, month - 1, day, hour, minute));
    return (
      date.getUTCFullYear() === year &&
      date.getUTCMonth() === month - 1 &&
      date.getUTCDate() === day &&
      date.getUTCHours() === hour &&
      date.getUTCMinutes() === minute
    );
  }, "実在する日時を入力してください");
const TimezoneOffsetSchema = z.number().int().min(-720).max(840);

export const CalorieItemInputSchema = z.object({
  name: z.string().trim().min(1, "品目名は必須です").max(255),
  kcal: PositiveCalorieIntegerSchema,
  note: z.string().max(10_000).default(""),
});

export const UpdateCalorieItemSchema = CalorieItemInputSchema.extend({
  itemId: z.number().int().positive(),
});

export const CalorieRecordInputSchema = z.object({
  consumed_at: LocalMinuteSchema,
  item_id: z.number().int().positive(),
  quantity: NonNegativeCalorieIntegerSchema,
  tz_offset_minutes: TimezoneOffsetSchema,
});

export const UpdateCalorieRecordSchema = CalorieRecordInputSchema.extend({
  recordId: z.number().int().positive(),
});

export const CalorieRecordIdSchema = z.object({
  recordId: z.number().int().positive(),
});

export const ListCalorieRecordsSchema = z.object({
  window_offset: z.number().int().min(0).max(120).default(0),
  tz_offset_minutes: TimezoneOffsetSchema,
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
});

export const ImportCalorieItemsSchema = z.object({
  rows: z.array(CalorieItemCsvRowSchema).max(MAX_CALORIE_CSV_ROWS),
});

export const ImportCalorieRecordsSchema = z.object({
  rows: z.array(CalorieRecordCsvRowSchema).max(MAX_CALORIE_CSV_ROWS),
  tz_offset_minutes: TimezoneOffsetSchema,
});

// ── タイマー操作スキーマ ──

export const CreateTimerSchema = z
  .object({
    name: z.string().trim().max(255),
    mode: TimerModeSchema.default("countdown"),
    base_seconds: z.number().int().min(0, "ベース時間は0以上の整数が必要です"),
    target_minutes: z.number().int().min(0).max(1439).optional(),
    tz_offset_minutes: z.number().int().min(-720).max(840).optional(),
    adjust_minutes: z
      .number()
      .int()
      .min(1)
      .max(999)
      .default(TIMER_DEFAULT_ADJUST_MINUTES),
    // 1回限りのタイマー。満了時に削除ボタンを強調し、確認ダイアログを省略する
    ephemeral: z.boolean().default(false),
    // 期限切れ後にビープを鳴らす秒数（上限・既定値の根拠は TIMER_DEFAULT_RING_SECONDS のコメントを参照）
    ring_seconds: z
      .number()
      .int()
      .min(1)
      .max(3600)
      .default(TIMER_DEFAULT_RING_SECONDS),
  })
  .refine(
    (data) =>
      data.mode !== "alarm" ||
      (data.target_minutes !== undefined &&
        data.tz_offset_minutes !== undefined),
    { message: "アラームモードでは目標時刻とタイムゾーンオフセットが必須です" },
  );

export const UpdateTimerSchema = z
  .object({
    timerId: z.number().int().positive(),
    name: z.string().trim().max(255).optional(),
    mode: TimerModeSchema.optional(),
    base_seconds: z.number().int().min(0).optional(),
    target_minutes: z.number().int().min(0).max(1439).optional(),
    tz_offset_minutes: z.number().int().min(-720).max(840).optional(),
    adjust_minutes: z.number().int().min(1).max(999).optional(),
    ring_seconds: z.number().int().min(1).max(3600).optional(),
  })
  .refine(
    (data) =>
      data.mode !== "alarm" ||
      (data.target_minutes !== undefined &&
        data.tz_offset_minutes !== undefined),
    { message: "アラームモードでは目標時刻とタイムゾーンオフセットが必須です" },
  )
  .refine(
    (data) =>
      data.mode !== "countdown" ||
      data.base_seconds !== undefined ||
      data.mode === undefined,
    { message: "カウントダウンモードではベース時間が必須です" },
  );

export const TimerIdSchema = z.object({
  timerId: z.number().int().positive(),
});

export const StartTimerSchema = z.object({
  timerId: z.number().int().positive(),
  tz_offset_minutes: z.number().int().min(-720).max(840).optional(),
});

export const ResetTimerSchema = z.object({
  timerId: z.number().int().positive(),
  tz_offset_minutes: z.number().int().min(-720).max(840).optional(),
});

export const TimerStopSchema = z.object({
  timerId: z.number().int().positive(),
  // アラーム発火時の started_at。リセット/再開されていないことを確認するために使用
  started_at: z.string().datetime().nullable().optional(),
});

export const AdjustTimerSchema = z.object({
  timerId: z.number().int().positive(),
  minutes: z.number().int(),
});

export const SetTimerTimeSchema = z.object({
  timerId: z.number().int().positive(),
  seconds: z.number().int().min(0).max(359999),
  target_minutes: z.number().int().min(0).max(1439).optional(),
  tz_offset_minutes: z.number().int().min(-720).max(840).optional(),
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

export const LoginSchema = z.object({
  userId: z.string().min(1),
  password: z.string().min(1),
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
  taskIds: z.array(z.number().int().positive()),
});

export const ReorderTimersSchema = z.object({
  timerIds: z.array(z.number().int().positive()),
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

export const DownloadAttachmentInputSchema = z.object({
  attachmentId: z.number().int().positive(),
});

// ── 型エクスポート ──

export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type ShowType = z.infer<typeof ShowTypeSchema>;
export type ListStatus = z.infer<typeof ListStatusSchema>;
/** タグ情報型（`TagInfoSchema` からの推論） */
export type TagInfo = z.infer<typeof TagInfoSchema>;

export type CreateTaskInput = z.infer<typeof CreateTaskSchema>;
export type UpdateTaskInput = z.infer<typeof UpdateTaskSchema>;
export type CreateListInput = z.infer<typeof CreateListSchema>;
export type UpdateListInput = z.infer<typeof UpdateListSchema>;
export type GetListTasksInput = z.infer<typeof GetListTasksSchema>;
export type CreateTimerInput = z.infer<typeof CreateTimerSchema>;
export type UpdateTimerInput = z.infer<typeof UpdateTimerSchema>;
export type AdjustTimerInput = z.infer<typeof AdjustTimerSchema>;
export type SetTimerTimeInput = z.infer<typeof SetTimerTimeSchema>;
export type StartTimerInput = z.infer<typeof StartTimerSchema>;
export type ResetTimerInput = z.infer<typeof ResetTimerSchema>;
export type TimerStopInput = z.infer<typeof TimerStopSchema>;
export type SearchTasksInput = z.infer<typeof SearchTasksSchema>;
export type ReorderTasksInput = z.infer<typeof ReorderTasksSchema>;
export type MergeListInput = z.infer<typeof MergeListSchema>;
export type ReorderTimersInput = z.infer<typeof ReorderTimersSchema>;
export type RegisterUserInput = z.infer<typeof RegisterUserSchema>;
export type LoginInput = z.infer<typeof LoginSchema>;
export type GetActiveTasksInput = z.infer<typeof GetActiveTasksSchema>;
export type CreateAttachmentInput = z.infer<typeof CreateAttachmentSchema>;
export type DeleteAttachmentInput = z.infer<typeof DeleteAttachmentSchema>;
export type DownloadAttachmentInput = z.infer<
  typeof DownloadAttachmentInputSchema
>;
export type CalorieItemInput = z.infer<typeof CalorieItemInputSchema>;
export type UpdateCalorieItemInput = z.infer<typeof UpdateCalorieItemSchema>;
export type CalorieRecordInput = z.infer<typeof CalorieRecordInputSchema>;
export type UpdateCalorieRecordInput = z.infer<
  typeof UpdateCalorieRecordSchema
>;
export type ListCalorieRecordsInput = z.infer<typeof ListCalorieRecordsSchema>;
export type CalorieItemCsvRow = z.infer<typeof CalorieItemCsvRowSchema>;
export type CalorieRecordCsvRow = z.infer<typeof CalorieRecordCsvRowSchema>;
