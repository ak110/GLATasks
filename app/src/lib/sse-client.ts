/**
 * @fileoverview SSE 共有接続管理 + サーバー時刻オフセット管理
 *
 * 各ページが個別に EventSource を作成していた仕組みを統合し、
 * +layout.svelte で1つの接続を管理する。
 * サーバー時刻オフセットもここで一元管理する。
 *
 * 接続成立 (初回および再接続) のたびに TanStack Query の
 * 全クエリを invalidate し、切断中に取りこぼしたかもしれない更新を取り直す。
 *
 * ブラウザのネットワークタイマー減速・スリープ・瞬断などで EventSource が
 * OPEN のまま実通信が停止する「ゾンビ化」を検知するため、
 * 受信ウォッチドッグとエラー時即時再接続を組み合わせた接続健全性監視を行う。
 */

import type { QueryClient } from "@tanstack/svelte-query";
import type { SseEventName } from "./sse-events";

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

// 接続健全性監視のパラメーター（ms）
// サーバー側 heartbeat 周期 30秒に対し 2.5倍のマージンで閾値 75秒とする
const WATCHDOG_INTERVAL_MS = 30_000;
const RECEIVE_TIMEOUT_MS = 75_000;

// SSE 接続管理
let eventSource: EventSource | null = null;
let queryClientRef: QueryClient | null = null;
let lastReceivedAt = 0;
let watchdogTimer: ReturnType<typeof setInterval> | null = null;
type EventCallback = (event: MessageEvent) => void;
const subscribers = new Map<string, Set<EventCallback>>();

/** SSE 接続を開始する */
export function connect(queryClient: QueryClient): void {
  if (eventSource) return;

  queryClientRef = queryClient;
  lastReceivedAt = Date.now();

  const es = new EventSource("/api/events");
  eventSource = es;

  // 接続確立時の処理:
  // 1. サーバー時刻から暫定オフセットを設定 (tRPC レスポンスの RTT/2 補正値で上書きされる)
  // 2. 全クエリを invalidate して、切断中に取りこぼしたイベントぶんを取り直す
  //    (EventSource は自動再接続するため、再接続時もこのハンドラが再発火する)
  es.addEventListener("connected", (e: MessageEvent) => {
    touchReceived();
    const serverMs = Number(e.data);
    if (serverMs) {
      setServerOffset(serverMs - Date.now());
    }
    void queryClient.invalidateQueries();
  });

  // heartbeat はサーバー側の生存通知。ウォッチドッグの最終受信時刻更新のみに使う
  // （サーバー時刻オフセット更新には用いない。
  //  SSE は片道通信で RTT を測定できない。
  //  heartbeat のサーバー時刻でオフセットを上書きすると精度が劣化する）
  es.addEventListener("heartbeat", () => {
    touchReceived();
  });

  // EventSource の error イベント発火時、接続状態が CLOSED なら自動再接続が
  // 機能しない状態のため即時に再接続する。CONNECTING 中はブラウザの自動再接続に委ねる
  es.addEventListener("error", () => {
    if (eventSource && eventSource.readyState === EventSource.CLOSED) {
      forceReconnect();
    }
  });

  // 登録済みイベントのリスナーを設定
  for (const [eventType, callbacks] of subscribers) {
    es.addEventListener(eventType, (e: MessageEvent) => {
      touchReceived();
      for (const cb of callbacks) {
        cb(e);
      }
    });
  }

  startWatchdog();
}

/** SSE 接続を切断する */
export function disconnect(): void {
  stopWatchdog();
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  queryClientRef = null;
}

/**
 * SSE イベントを購読する（戻り値は解除関数）
 *
 * subscribe は connect より前に呼んでも動作する。
 * connect 時に subscribers に登録済みの全イベントタイプのリスナーが
 * EventSource に一括設定される。
 */
export function subscribe(
  eventType: SseEventName,
  callback: EventCallback,
): () => void {
  let callbacks = subscribers.get(eventType);
  if (!callbacks) {
    callbacks = new Set();
    subscribers.set(eventType, callbacks);
  }
  callbacks.add(callback);

  // 既に接続中なら EventSource にもリスナーを追加し、解除関数でアンマウント時に削除する
  if (eventSource) {
    const wrappedHandler = (e: MessageEvent) => {
      touchReceived();
      if (callbacks!.has(callback)) {
        callback(e);
      }
    };
    eventSource.addEventListener(eventType, wrappedHandler);

    return () => {
      eventSource?.removeEventListener(eventType, wrappedHandler);
      callbacks!.delete(callback);
      if (callbacks!.size === 0) {
        subscribers.delete(eventType);
      }
    };
  }

  return () => {
    callbacks!.delete(callback);
    if (callbacks!.size === 0) {
      subscribers.delete(eventType);
    }
  };
}

/**
 * 接続健全性を診断し、受信途絶時間が閾値を超えていれば強制再接続する。
 *
 * `visibilitychange` で可視復帰した瞬間に呼び出すと、ウォッチドッグの
 * 次回判定を待たずに前倒しでゾンビ接続を検知できる。
 */
export function checkConnection(): void {
  if (!eventSource) return;
  const elapsed = Date.now() - lastReceivedAt;
  if (elapsed >= RECEIVE_TIMEOUT_MS) {
    forceReconnect();
  }
}

/** 最終受信時刻を現在時刻で更新する */
function touchReceived(): void {
  lastReceivedAt = Date.now();
}

/** ウォッチドッグを起動する（既に動作中なら何もしない） */
function startWatchdog(): void {
  if (watchdogTimer) return;
  watchdogTimer = setInterval(checkConnection, WATCHDOG_INTERVAL_MS);
}

/** ウォッチドッグを停止する */
function stopWatchdog(): void {
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
}

/** 既存接続を破棄して即時再接続する（接続済み QueryClient を再利用する） */
function forceReconnect(): void {
  const client = queryClientRef;
  if (!client) return;
  disconnect();
  connect(client);
}
