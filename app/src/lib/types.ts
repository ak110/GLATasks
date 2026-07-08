/**
 * @fileoverview アプリケーション共通の型定義
 *
 * tRPC レスポンスのクライアント側型を集約する。
 * `TagInfo`・`TAG_COLOR_KEYS`・`TagColorKey` は `schemas.ts` が正とし、ここではre-exportのみ行う。
 */

export { TAG_COLOR_KEYS } from "./schemas";
export type { TagColorKey, TagInfo, TaskKind } from "./schemas";

import type { TagInfo, TaskKind } from "./schemas";

/** リスト情報 */
export type ListInfo = {
  id: number;
  title: string;
  sort_order: number;
  last_updated: string;
  status: string;
  /** 未完了かつ kind="todo" のタスク件数（通知バッジ用） */
  todo_count: number;
};

/** 添付ファイルメタ情報 */
export type AttachmentMeta = {
  id: number;
  filename: string;
  mimeType: string;
  size: number;
  created: string;
};

/** タスク情報 */
export type TaskInfo = {
  id: number;
  title: string;
  notes: string;
  status: string;
  kind: TaskKind;
  tags: TagInfo[];
  attachments: AttachmentMeta[];
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

/**
 * 差分 sync 用タスク項目。
 * クライアント側のリスト単位フィルタ・並び順表示に必要な全フィールドを含む。
 */
export type TaskListItem = {
  /**
   * Svelte の `{#each}` keying 用の安定値。楽観追加時は仮IDを保持し、
   * サーバー応答後にidが実IDへ書き換わっても同じ値を維持してDOM identityを保つ。
   * サーバー応答経由のタスクでは id と同値を入れる。
   */
  _key: number;
  id: number;
  listId: number;
  title: string;
  notes: string;
  status: string;
  kind: TaskKind;
  tags: TagInfo[];
  sort_order: number;
  /** UTC ISO 文字列 */
  updated: string;
  attachments: AttachmentMeta[];
};

/** 全アクティブタスク取得レスポンス（差分 sync 対応） */
export type GetActiveTasksResult = {
  tasks: TaskListItem[];
  /** 次回リクエストで使う基準時刻（1秒 overlap 済みの UTC ISO 文字列） */
  serverTime: string;
  /** full: 全件取得、delta: 差分取得 */
  mode: "full" | "delta";
};

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

/**
 * 定期TODOスケジュール情報。
 *
 * 新設型のため、既存の `TaskListItem` 等が持つスネークケース混在フィールド命名
 * （`sort_order` 等）を踏襲せず、全フィールドをキャメルケースへ統一する。
 */
export type ScheduleInfo = {
  id: number;
  listId: number;
  title: string;
  tags: TagInfo[];
  /** RFC5545形式のRRULE文字列（DTSTART;TZID=Asia/Tokyo:... を含む） */
  rrule: string;
  /** UTC ISO 文字列。未発火なら null */
  lastFired: string | null;
  enabled: boolean;
  sortOrder: number;
};
