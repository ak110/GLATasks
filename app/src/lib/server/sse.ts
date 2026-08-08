/**
 * @fileoverview SSE (Server-Sent Events) 接続管理と差分catchup機構
 *
 * ユーザーごとに SSE 接続を管理し、mutation 完了後に通知を配信する。
 * データは含めず、イベント種別のみを送信する（暗号化不要）。
 *
 * ## Last-Event-IDによる差分catchup方式
 *
 * SSEイベントには `id:` フィールドでプロセス内グローバルの単調増加整数を付与する。
 * クライアントが再接続時に `Last-Event-ID` ヘッダーまたは URL クエリーパラメータで
 * 直前に受信したIDを通知してきた場合、`replayEvents()` でバッファ内の該当ID以降を
 * リプレイする。バッファ外れ（バッファ縮退・TTL失効・プロセス再起動など）では
 * `reset` イベントを送信し、クライアント側で全クエリーを invalidate させる。
 *
 * ## メモリ内バッファのGC条件
 *
 * ユーザー単位のリングバッファとして直近イベントを保持する。
 * 件数が `BUFFER_MAX_EVENTS` を超えた場合は古いイベントから逐次破棄し、
 * 最終発行から `BUFFER_TTL_MS` を超えたユーザーバッファは全削除する。
 * GCはイベント発行時に他ユーザーバッファのTTLもまとめて点検する方式で、
 * 独立タイマーは持たない。
 */

import type { SseEventName } from "$lib/sse-events";
import { SSE_EVENTS } from "$lib/sse-events";

export type { SseEventName };

/** モジュールスコープで再利用し、呼び出しごとの生成コストを排除する */
const encoder = new TextEncoder();

/** リングバッファのユーザー単位の上限件数 */
const BUFFER_MAX_EVENTS = 1000;

/** 最終イベント発行からの経過時間がこの値を超えたユーザーバッファを破棄する（ms） */
const BUFFER_TTL_MS = 30 * 60 * 1000;

/** バッファに保持する1イベントのスナップショット */
interface BufferedEvent {
  id: number;
  type: SseEventName;
  sourceTabId: string;
}

/** ユーザー単位のバッファ状態 */
interface UserBuffer {
  events: BufferedEvent[];
  lastTouchAt: number;
}

/** ユーザーID → 接続中の ReadableStreamController の Set */
const connections = new Map<number, Set<ReadableStreamDefaultController>>();

/** ユーザーID → 直近イベントのリングバッファ */
const buffers = new Map<number, UserBuffer>();

/**
 * SSEイベント採番用のプロセス内グローバルカウンター。
 * プロセス再起動でリセットされるが、再起動時はバッファ外れとして
 * `reset` イベントで整合性を回復するため問題ない。
 */
let nextEventId = 1;

/** SSE 接続を登録する */
export function addConnection(
  userId: number,
  controller: ReadableStreamDefaultController,
): void {
  let userConnections = connections.get(userId);
  if (!userConnections) {
    userConnections = new Set();
    connections.set(userId, userConnections);
  }
  userConnections.add(controller);
}

/** SSE 接続を解除する */
export function removeConnection(
  userId: number,
  controller: ReadableStreamDefaultController,
): void {
  const userConnections = connections.get(userId);
  if (!userConnections) return;
  userConnections.delete(controller);
  if (userConnections.size === 0) {
    connections.delete(userId);
  }
}

/** 指定ユーザーの全接続にイベントを送信する */
export function sendEvent(
  userId: number,
  eventType: SseEventName,
  sourceTabId?: string | null,
): void {
  const id = nextEventId++;
  appendToBuffer(userId, {
    id,
    type: eventType,
    sourceTabId: sourceTabId ?? "",
  });
  gcExpiredBuffers();

  const userConnections = connections.get(userId);
  if (!userConnections) return;
  const encoded = encoder.encode(formatEvent(id, eventType, sourceTabId ?? ""));
  for (const controller of userConnections) {
    try {
      controller.enqueue(encoded);
    } catch {
      // 接続が閉じられている場合は無視（removeConnection で後片付けされる）
    }
  }
}

/**
 * Last-Event-ID をもとに、バッファ内の該当ID以降のイベントを順次送信する。
 *
 * バッファに該当ID（厳密にはそのIDより新しいイベント）が見つからない場合は
 * `reset` イベントを送信し、クライアントへ全リフレッシュを促す。
 */
export function replayEvents(
  userId: number,
  lastEventId: number,
  controller: ReadableStreamDefaultController,
): void {
  const buffer = buffers.get(userId);
  const oldest = buffer?.events[0];
  const newest = buffer?.events[buffer.events.length - 1];
  // バッファ空・最古より前で欠落・最新より未来（再起動シナリオ）はいずれもbufferを信用できない
  if (
    !buffer ||
    !oldest ||
    !newest ||
    oldest.id > lastEventId + 1 ||
    newest.id < lastEventId
  ) {
    enqueueReset(controller);
    return;
  }
  const replayables = buffer.events.filter((e) => e.id > lastEventId);
  for (const event of replayables) {
    try {
      controller.enqueue(
        encoder.encode(formatEvent(event.id, event.type, event.sourceTabId)),
      );
    } catch {
      // 接続が閉じられている場合は中断（removeConnection で後片付けされる）
      return;
    }
  }
}

/** SSEプロトコル形式の文字列を生成する */
function formatEvent(
  id: number,
  eventType: SseEventName,
  sourceTabId: string,
): string {
  return `id: ${id}\nevent: ${eventType}\ndata: ${sourceTabId}\n\n`;
}

/** `reset` イベントをコントローラーへ送出する */
function enqueueReset(controller: ReadableStreamDefaultController): void {
  try {
    controller.enqueue(
      encoder.encode(`event: ${SSE_EVENTS.reset}\ndata: \n\n`),
    );
  } catch {
    // 接続が閉じられている場合は無視
  }
}

/** ユーザーのバッファへイベントを追記し、上限件数を超えた古いものを破棄する */
function appendToBuffer(userId: number, event: BufferedEvent): void {
  let buffer = buffers.get(userId);
  if (!buffer) {
    buffer = { events: [], lastTouchAt: Date.now() };
    buffers.set(userId, buffer);
  }
  buffer.events.push(event);
  if (buffer.events.length > BUFFER_MAX_EVENTS) {
    buffer.events.splice(0, buffer.events.length - BUFFER_MAX_EVENTS);
  }
  buffer.lastTouchAt = Date.now();
}

/** TTL経過済みのユーザーバッファを破棄する */
function gcExpiredBuffers(): void {
  const now = Date.now();
  for (const [userId, buffer] of buffers) {
    if (now - buffer.lastTouchAt > BUFFER_TTL_MS) {
      buffers.delete(userId);
    }
  }
}

/** テスト用: 内部状態をリセットする */
export function _resetForTest(): void {
  connections.clear();
  buffers.clear();
  nextEventId = 1;
}
