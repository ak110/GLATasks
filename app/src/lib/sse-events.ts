/**
 * @fileoverview SSEイベント種別の定数定義
 *
 * サーバー・クライアント双方から参照する共用モジュール。
 * サーバー専用の `server/sse.ts` はこちらからimportし、
 * クライアントの `sse-client.ts` も同様にここを参照する。
 */

/** SSEイベント種別の定数オブジェクト */
export const SSE_EVENTS = {
  listsUpdated: "lists:updated",
  tasksUpdated: "tasks:updated",
  timersUpdated: "timers:updated",
  usersPreferencesUpdated: "users:preferences:updated",
} as const;

/** SSEイベント種別の型 */
export type SseEventName = (typeof SSE_EVENTS)[keyof typeof SSE_EVENTS];
