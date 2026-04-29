/**
 * @fileoverview SSE (Server-Sent Events) 接続管理
 *
 * ユーザーごとに SSE 接続を管理し、mutation 完了後に通知を配信する。
 * データは含めず、イベント種別のみを送信する（暗号化不要）。
 */

import type { SseEventName } from "$lib/sse-events";

export type { SseEventName };

/** モジュールスコープで再利用し、呼び出しごとの生成コストを排除する */
const encoder = new TextEncoder();

/** ユーザーID → 接続中の ReadableStreamController の Set */
const connections = new Map<number, Set<ReadableStreamDefaultController>>();

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
  const userConnections = connections.get(userId);
  if (!userConnections) return;
  // data に発信元タブIDを含める（クライアント側で自タブのイベントを識別するため）
  const data = `event: ${eventType}\ndata: ${sourceTabId ?? ""}\n\n`;
  const encoded = encoder.encode(data);
  for (const controller of userConnections) {
    try {
      controller.enqueue(encoded);
    } catch {
      // 接続が閉じられている場合は無視（removeConnection で後片付けされる）
    }
  }
}
