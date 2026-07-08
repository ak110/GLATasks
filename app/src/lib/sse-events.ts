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
  schedulesUpdated: "schedules:updated",
  /**
   * バッファ外れまたはサーバー再起動などで差分catchupが成立しない場合に送出する。
   * クライアントは受信時に全クエリーを invalidate して整合性を回復する。
   */
  reset: "reset",
} as const;

/** SSEイベント種別の型 */
export type SseEventName = (typeof SSE_EVENTS)[keyof typeof SSE_EVENTS];
