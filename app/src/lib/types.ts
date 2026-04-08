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

/** タスク情報 */
export type TaskInfo = {
  id: number;
  title: string;
  notes: string;
  status: string;
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
  remaining_seconds: number;
  started_at: string | null;
  sort_order: number;
};

/** タイマー一覧取得レスポンス */
export type TimersResult = {
  timers: TimerInfo[];
  server_time: string;
};
