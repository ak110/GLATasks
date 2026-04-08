/**
 * @fileoverview SSE 共有接続管理 + サーバー時刻オフセット管理
 *
 * 各ページが個別に EventSource を作成していた仕組みを統合し、
 * +layout.svelte で1つの接続を管理する。
 * サーバー時刻オフセットもここで一元管理する。
 *
 * 接続成立 (初回および EventSource の自動再接続) のたびに TanStack Query の
 * 全クエリを invalidate し、切断中に取りこぼしたかもしれない更新を取り直す。
 */

import type { QueryClient } from "@tanstack/svelte-query";

// サーバー時刻オフセット（ms）: サーバー時刻 = Date.now() + offset
let serverOffset = 0;
// オフセット変更通知コールバック
const offsetListeners = new Set<(offset: number) => void>();

/** サーバー時刻オフセット（ms）を取得する */
export function getServerOffset(): number {
  return serverOffset;
}

/** サーバー時刻オフセット（ms）を設定し、リスナーに通知する */
export function setServerOffset(value: number): void {
  serverOffset = value;
  for (const cb of offsetListeners) {
    cb(value);
  }
}

/** オフセット変更時のコールバックを登録する（戻り値は解除関数） */
export function onOffsetChange(cb: (offset: number) => void): () => void {
  offsetListeners.add(cb);
  return () => offsetListeners.delete(cb);
}

// SSE 接続管理
let eventSource: EventSource | null = null;
type EventCallback = (event: MessageEvent) => void;
const subscribers = new Map<string, Set<EventCallback>>();

/** SSE 接続を開始する */
export function connect(queryClient: QueryClient): void {
  if (eventSource) return;

  const es = new EventSource("/api/events");
  eventSource = es;

  // 接続確立時の処理:
  // 1. サーバー時刻から暫定オフセットを設定 (tRPC レスポンスの RTT/2 補正値で上書きされる)
  // 2. 全クエリを invalidate して、切断中に取りこぼしたイベントぶんを取り直す
  //    (EventSource は自動再接続するため、再接続時もこのハンドラが再発火する)
  es.addEventListener("connected", (e: MessageEvent) => {
    const serverMs = Number(e.data);
    if (serverMs) {
      setServerOffset(serverMs - Date.now());
    }
    void queryClient.invalidateQueries();
  });

  // 登録済みイベントのリスナーを設定
  for (const [eventType, callbacks] of subscribers) {
    es.addEventListener(eventType, (e: MessageEvent) => {
      for (const cb of callbacks) {
        cb(e);
      }
    });
  }
}

/** SSE 接続を切断する */
export function disconnect(): void {
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
}

/**
 * SSE イベントを購読する（戻り値は解除関数）
 *
 * subscribe は connect より前に呼んでも動作する。
 * connect 時に subscribers に登録済みの全イベントタイプのリスナーが
 * EventSource に一括設定される。
 */
export function subscribe(
  eventType: string,
  callback: EventCallback,
): () => void {
  let callbacks = subscribers.get(eventType);
  if (!callbacks) {
    callbacks = new Set();
    subscribers.set(eventType, callbacks);
  }
  callbacks.add(callback);

  // 既に接続中なら EventSource にもリスナーを追加
  if (eventSource) {
    const handler = (e: MessageEvent) => {
      if (callbacks!.has(callback)) {
        callback(e);
      }
    };
    eventSource.addEventListener(eventType, handler);
  }

  return () => {
    callbacks!.delete(callback);
    if (callbacks!.size === 0) {
      subscribers.delete(eventType);
    }
  };
}
