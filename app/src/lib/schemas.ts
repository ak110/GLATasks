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

export const TaskStatusSchema = z.enum(["active", "completed", "archived"]);
export const ShowTypeSchema = z.enum(["active", "archived", "all"]);
export const ListStatusSchema = z.enum(["active", "archived"]);

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
});

// ── タスク操作スキーマ ──

export const CreateTaskSchema = z.object({
  listId: z.number().int().positive(),
  text: z.string().min(1, "タスク内容は必須です").max(100000),
  tags: TagsSchema.optional(),
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
  })
  .refine(
    (data) =>
      data.text !== undefined ||
      data.status !== undefined ||
      data.move_to !== undefined ||
      data.tags !== undefined,
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

/** 鳴り続けオプションのデフォルト（オプトイン）*/
export const TIMER_DEFAULT_KEEP_RINGING = false;

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
  keep_ringing: z.boolean().optional(),
  base_seconds: z.number().int().min(0).max(359999).optional(),
  adjust_minutes: z.number().int().min(1).max(999).optional(),
  mode: TimerModeSchema.optional(),
});
export type UserPreferences = z.infer<typeof UserPreferencesSchema>;

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
    // 使い切り (1 回限り) タイマー。満了時に削除ボタンを強調し、確認ダイアログを省略する
    ephemeral: z.boolean().default(false),
    // 期限切れ後に利用者が止めるまでビープを鳴らし続けるかどうか
    keep_ringing: z.boolean().default(TIMER_DEFAULT_KEEP_RINGING),
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
    keep_ringing: z.boolean().optional(),
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
