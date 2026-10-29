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
  name: z
    .string()
    .trim()
    .min(1)
    .max(40)
    .describe("タグ名（前後の空白を除いて1～40文字）"),
  color: z.enum(TAG_COLOR_KEYS).describe("タグの色"),
});

/** タスクに付与するタグ配列（同一タスク内での上限は32個） */
export const TagsSchema = z.array(TagInfoSchema).max(32);

// ── 検索スキーマ ──

export const SearchTasksSchema = z.object({
  query: z
    .string()
    .min(1)
    .max(255)
    .describe("タスク本文に部分一致で含まれる語句（1～255文字）"),
  showType: ShowTypeSchema.default("active").describe(
    "検索するタスクの範囲。active は使用中のリストにあるアーカイブ済み以外のタスク、archived は全リストのアーカイブ済みタスク、all は全リストの全タスク。省略時は active",
  ),
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
  listId: z.number().int().positive().describe("追加先のリストのID"),
  text: z
    .string()
    .min(1, "タスク内容は必須です")
    .refine(isWithinMaxTaskTextBytes, taskTextTooLongMessage)
    .describe("タスク本文。1行目がタイトル、2行目以降が備考になる"),
  tags: TagsSchema.optional().describe(
    "タスクに付けるタグ（最大32個）。省略時はタグなし",
  ),
  kind: TaskKindSchema.optional().describe(
    "タスクの種別。normal は通常のタスク、todo は通知バッジの件数に数えるTODO。省略時は normal",
  ),
});

export const UpdateTaskSchema = z
  .object({
    listId: z
      .number()
      .int()
      .positive()
      .describe("タスクが現在属するリストのID"),
    taskId: z.number().int().positive().describe("更新するタスクのID"),
    text: z
      .string()
      .refine(isWithinMaxTaskTextBytes, taskTextTooLongMessage)
      .optional()
      .describe("新しい本文。1行目がタイトル、2行目以降が備考になる"),
    status: TaskStatusSchema.optional().describe(
      "新しい状態。active は未着手、running は作業中、completed は完了、archived はアーカイブ済み",
    ),
    completed: z
      .string()
      .datetime()
      .nullable()
      .optional()
      .describe(
        "完了日時（ISO 8601形式のUTC）を上書きする。null で消去する。省略時は status の変更に従う",
      ),
    moveTo: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("移動先のリストのID。移動したタスクは移動先の先頭に置く"),
    keepOrder: z
      .boolean()
      .default(false)
      .describe(
        "true の場合、text を変更してもリスト内の位置を保つ。省略時は false で、本文を変更したタスクをリストの先頭へ移す",
      ),
    tags: TagsSchema.optional().describe(
      "タスクのタグ全体を置き換える配列（最大32個）。空配列でタグを全て外す",
    ),
    kind: TaskKindSchema.optional().describe(
      "新しい種別。normal は通常のタスク、todo は通知バッジの件数に数えるTODO",
    ),
  })
  .refine(
    (data) =>
      data.text !== undefined ||
      data.status !== undefined ||
      data.moveTo !== undefined ||
      data.tags !== undefined ||
      data.kind !== undefined,
    {
      message:
        "更新する項目が指定されていません。text・status・moveTo・tags・kindのいずれかを指定してください",
    },
  );

// ── リスト操作スキーマ ──

export const CreateListSchema = z.object({
  title: z
    .string()
    .min(1, "タイトルは必須です")
    .max(255)
    .describe("リスト名（1～255文字）"),
});

export const UpdateListSchema = z.object({
  listId: z.number().int().positive().describe("対象のリストのID"),
  title: z
    .string()
    .min(1, "タイトルは必須です")
    .max(255)
    .describe("新しいリスト名（1～255文字）"),
});

export const GetListTasksSchema = z.object({
  listId: z.number().int().positive().describe("取得するリストのID"),
  showType: ShowTypeSchema.describe(
    "取得するタスクの範囲。active はアーカイブ済み以外、archived はアーカイブ済みだけ、all は全タスク",
  ),
  ifModifiedSince: z
    .string()
    .datetime()
    .optional()
    .describe(
      "前回取得した lastModified（ISO 8601形式のUTC）。指定すると、それ以降に変更が無い場合に status: 304 だけを返す。省略時は常にタスクを返す",
    ),
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
  ringSeconds: TimerRingSecondsSchema.optional().describe(
    "新規タイマーが時間切れ後に音を鳴らす秒数（1～3600）",
  ),
  baseSeconds: TimerSecondsSchema.optional().describe(
    "新規カウントダウンタイマーの時間（秒、0～359999）",
  ),
  adjustMinutes: TimerAdjustMinutesSchema.optional().describe(
    "新規タイマーの延長・短縮ボタン1回分の分数（1～999）",
  ),
  mode: TimerModeSchema.optional().describe(
    "新規タイマーのモード。countdown はカウントダウン、alarm は時刻指定のアラーム",
  ),
  calorieGoalKcal: z
    .number()
    .int()
    .positive()
    .max(1_000_000)
    .optional()
    .describe("カロリーの1日の目標値（kcal）"),
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
  windowOffset: z
    .number()
    .int()
    .min(0)
    .max(120)
    .default(0)
    .describe(
      "取得する30日単位の期間。0 は今日までの30日、1 はその前の30日（0～120）。日の境界は現地時刻の4時。省略時は 0",
    ),
  tzOffsetMinutes: TimezoneOffsetSchema.describe(
    "期間の日境界を決めるUTCからの時差（分）。日本時間は540",
  ),
});

export const GetCalorieSummarySchema = z.object({
  tzOffsetMinutes: TimezoneOffsetSchema.describe(
    "日ごとの集計の日境界を決めるUTCからの時差（分）。日本時間は540",
  ),
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
    name: z
      .string()
      .trim()
      .max(255)
      .describe("タイマー名（255文字以内。空文字も可）"),
    mode: TimerModeSchema.default("countdown").describe(
      "countdown はカウントダウン、alarm は時刻指定のアラーム。省略時は countdown",
    ),
    baseSeconds: TimerSecondsSchema.describe(
      "カウントダウンの時間（秒、0～359999）。リセット時もこの時間に戻る。アラームでは使わない",
    ),
    targetMinutes: z
      .number()
      .int()
      .min(0)
      .max(1439)
      .optional()
      .describe(
        "アラームの目標時刻を0時からの分数で表す（0～1439。7時30分は450）。mode が alarm の場合は必須",
      ),
    tzOffsetMinutes: TimezoneOffsetSchema.optional().describe(
      "目標時刻を解釈するUTCからの時差（分）。日本時間は540。mode が alarm の場合は必須",
    ),
    adjustMinutes: TimerAdjustMinutesSchema.default(
      TIMER_DEFAULT_ADJUST_MINUTES,
    ).describe(
      `画面の延長・短縮ボタン1回分の分数（1～999）。省略時は${TIMER_DEFAULT_ADJUST_MINUTES}`,
    ),
    // 1回限りのタイマー。満了時に削除ボタンを強調し、確認ダイアログを省略する
    ephemeral: z
      .boolean()
      .default(false)
      .describe(
        "true の場合は1回限りのタイマーとして作成と同時に開始し、満了後の削除を確認なしで行えるようにする。省略時は false",
      ),
    // 期限切れ後にビープを鳴らす秒数（上限・既定値の根拠は TIMER_DEFAULT_RING_SECONDS のコメントを参照）
    ringSeconds: TimerRingSecondsSchema.default(
      TIMER_DEFAULT_RING_SECONDS,
    ).describe(
      `時間切れ後に音を鳴らす秒数（1～3600）。省略時は${TIMER_DEFAULT_RING_SECONDS}`,
    ),
  })
  .refine(
    (data) =>
      data.mode !== "alarm" ||
      (data.targetMinutes !== undefined && data.tzOffsetMinutes !== undefined),
    { message: "アラームモードでは目標時刻とタイムゾーンオフセットが必須です" },
  );

export const UpdateTimerSchema = z
  .object({
    timerId: z.number().int().positive().describe("変更するタイマーのID"),
    name: z
      .string()
      .trim()
      .max(255)
      .optional()
      .describe("新しいタイマー名（255文字以内）"),
    mode: TimerModeSchema.optional().describe(
      "新しいモード。alarm へ変える場合は targetMinutes と tzOffsetMinutes、countdown へ変える場合は baseSeconds も指定する",
    ),
    baseSeconds: TimerSecondsSchema.optional().describe(
      "カウントダウンの時間（秒、0～359999）。リセット時に戻る時間を変え、現在の残り時間は変えない",
    ),
    targetMinutes: z
      .number()
      .int()
      .min(0)
      .max(1439)
      .optional()
      .describe(
        "アラームの目標時刻を0時からの分数で表す（0～1439。7時30分は450）",
      ),
    tzOffsetMinutes: TimezoneOffsetSchema.optional().describe(
      "目標時刻を解釈するUTCからの時差（分）。日本時間は540。targetMinutes を指定する場合に渡す",
    ),
    adjustMinutes: TimerAdjustMinutesSchema.optional().describe(
      "画面の延長・短縮ボタン1回分の分数（1～999）",
    ),
    ringSeconds: TimerRingSecondsSchema.optional().describe(
      "時間切れ後に音を鳴らす秒数（1～3600）",
    ),
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

const TimerIdFieldSchema = z
  .number()
  .int()
  .positive()
  .describe("対象のタイマーのID");

export const TimerIdSchema = z.object({
  timerId: TimerIdFieldSchema,
});

export const StartTimerSchema = z.object({
  timerId: TimerIdFieldSchema,
  tzOffsetMinutes: TimezoneOffsetSchema.optional().describe(
    "アラームの目標時刻を解釈するUTCからの時差（分）。日本時間は540。アラームでは必須で、カウントダウンでは使わない",
  ),
});

export const ResetTimerSchema = z.object({
  timerId: TimerIdFieldSchema,
  tzOffsetMinutes: TimezoneOffsetSchema.optional().describe(
    "アラームの目標時刻を解釈するUTCからの時差（分）。日本時間は540。アラームでは必須で、カウントダウンでは使わない",
  ),
});

export const TimerStopSchema = z.object({
  timerId: TimerIdFieldSchema,
  // アラーム発火時の startedAt。リセット/再開されていないことを確認するために使用
  startedAt: z
    .string()
    .datetime()
    .nullable()
    .optional()
    .describe(
      "timers.list で取得した startedAt（ISO 8601形式のUTC）。指定すると、その後にタイマーが再開・リセットされていない場合だけ止める。省略時は確認しない",
    ),
});

export const AdjustTimerSchema = z.object({
  timerId: TimerIdFieldSchema,
  minutes: z
    .number()
    .int()
    .describe("残り時間に加える分数。正の値で延長し、負の値で短縮する"),
});

export const SetTimerTimeSchema = z.object({
  timerId: TimerIdFieldSchema,
  seconds: TimerSecondsSchema.describe("設定する残り時間（秒、0～359999）"),
  targetMinutes: z
    .number()
    .int()
    .min(0)
    .max(1439)
    .optional()
    .describe(
      "アラームの新しい目標時刻を0時からの分数で表す（0～1439。7時30分は450）。カウントダウンでは無視する",
    ),
  tzOffsetMinutes: TimezoneOffsetSchema.optional().describe(
    "targetMinutes を解釈するUTCからの時差（分）。日本時間は540。指定すると残り時間を目標時刻から計算し、省略すると seconds を残り時間にする",
  ),
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
  since: z
    .string()
    .datetime()
    .optional()
    .describe(
      "差分取得の基準日時（ISO 8601形式のUTC）。前回の応答の serverTime を渡す。省略時はアーカイブ済み以外の全タスクを返す",
    ),
});

// ── リスト統合スキーマ ──

export const MergeListSchema = z.object({
  sourceListId: z
    .number()
    .int()
    .positive()
    .describe("統合元のリストのID。統合後に削除する"),
  targetListId: z
    .number()
    .int()
    .positive()
    .describe("統合先のリストのID。統合元と異なるリストを指定する"),
});

// ── 並び替えスキーマ ──

export const ReorderTasksSchema = z.object({
  listId: z.number().int().positive().describe("並べ替えるリストのID"),
  taskIds: z
    .array(z.number().int().positive())
    .refine(
      (ids) => new Set(ids).size === ids.length,
      "タスクIDが重複しています",
    )
    .describe("新しい並び順のタスクID（重複不可）。先頭が一番上になる"),
});

export const ReorderTimersSchema = z.object({
  timerIds: z
    .array(z.number().int().positive())
    .refine(
      (ids) => new Set(ids).size === ids.length,
      "タイマーIDが重複しています",
    )
    .describe("新しい並び順の全タイマーID（重複不可）。先頭が一番上になる"),
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
