/**
 * @fileoverview アプリケーション共通の型定義
 *
 * tRPC レスポンスのクライアント側型を集約する。
 */

/** リスト情報 */
export type ListInfo = {
  id: number;
  title: string;
  sort_order: number;
  last_updated: string;
  status: string;
};

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

/** タグ情報（タスクに付与するラベル） */
export type TagInfo = {
  name: string;
  color: TagColorKey;
};

/** タスク情報 */
export type TaskInfo = {
  id: number;
  title: string;
  notes: string;
  status: string;
  tags: TagInfo[];
};

/** 検索結果タスク情報 */
export type SearchTaskResult = TaskInfo & {
  listId: number;
  listTitle: string;
};

/** タスク一覧取得レスポンス（304 は未変更） */
export type GetTasksResult =
  | { status: 304 }
  | { status: 200; data: TaskInfo[]; lastModified: string };

/** タイマー情報 */
export type TimerInfo = {
  id: number;
  name: string;
  mode: "countdown" | "alarm";
  target_minutes: number | null;
  base_seconds: number;
  adjust_minutes: number;
  running: boolean;
  expired: boolean;
  ephemeral: boolean;
  keep_ringing: boolean;
  remaining_seconds: number;
  started_at: string | null;
  sort_order: number;
};

/** タイマー一覧取得レスポンス */
export type TimersResult = {
  timers: TimerInfo[];
  server_time: string;
};
