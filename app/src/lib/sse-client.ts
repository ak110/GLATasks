/**
 * @fileoverview SSE 共有接続管理 + サーバー時刻オフセット管理 + 差分catchup連携
 *
 * +layout.svelte で単一の EventSource 接続を管理し、各ページはこの共有接続を購読する。
 * サーバー時刻オフセットもここで一元管理する。
 *
 * ## 差分catchup連携
 *
 * 受信したイベントの `lastEventId` をモジュールスコープ変数に保持する。
 * 接続URLには値がある場合に限り `?lastEventId=<id>` を付加し、
 * 明示再接続（`forceReconnect()`）でも確実にサーバーへ伝達する。
 * `EventSource` の自動再接続では標準仕様により `Last-Event-ID` ヘッダーも
 * 送信されるため、サーバー側は両方を受け取る前提とする。
 *
 * 永続化は行わない。タブを閉じれば失う前提で、再起動後の初回接続は
 * サーバー側の `connected` イベントによる全 invalidate に委ねる。
 *
 * `reset` イベントを受信した場合は、`connected` 受信時と同じ全 `invalidateQueries()` を行い、
 * バッファ外れやサーバー再起動による差分取りこぼしから整合性を回復する。
 *
 * ## 接続健全性監視
 *
 * ブラウザのネットワークタイマー減速・スリープ・瞬断などで EventSource が
 * OPEN のまま実通信が停止する「ゾンビ化」を検知するため、
 * 受信ウォッチドッグとエラー時即時再接続を組み合わせる。
 *
 * ## ポーリングフォールバック連携
 *
 * 外部要因でSSE応答が長期間届かない経路（キャプティブポータル経由の遮断、
 * 中継機器のMITM応答バッファリング等）に備え、健全性状態 `HealthState` を
 * ウォッチドッグとは別経路で管理する。`connect()` 直後は `"initial"` 状態で
 * 10秒タイマーをセットし、何らかのイベント受信時に `"healthy"` へ遷移して
 * 60秒タイマーへ切り替える。タイマー発火時に `"unhealthy"` へ遷移する。
 * `sse-subscribe.ts` はこの状態変化を購読し、`"unhealthy"` 遷移直後に
 * フォールバックを1回即時実行し、以後30秒間隔のポーリングを継続する。
 */

import type { QueryClient } from "@tanstack/svelte-query";
import { SSE_EVENTS, type SseEventName } from "./sse-events";
import { debugLog } from "./debug-log";

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

// ポーリングフォールバック連携用の健全性閾値（ms）
// 初回接続後10秒・接続後の受信途絶60秒で `"unhealthy"` 判定する
const HEALTH_INITIAL_TIMEOUT_MS = 10_000;
const HEALTH_RECEIVE_TIMEOUT_MS = 60_000;

/** SSE 健全性状態 */
export type HealthState = "initial" | "healthy" | "unhealthy";

// SSE 接続管理
let eventSource: EventSource | null = null;
let queryClientRef: QueryClient | null = null;
let lastReceivedAt = 0;
let watchdogTimer: ReturnType<typeof setInterval> | null = null;
// 不健全判定用タイマー（閾値到達時刻に直接発火する）
let unhealthyTimer: ReturnType<typeof setTimeout> | null = null;
// 受信した最新の Last-Event-ID（数値文字列。未受信時は null）
let lastEventId: string | null = null;
// 健全性状態（初期値は "initial" だが、connect 前は外部観測されない）
let healthState: HealthState = "initial";
const healthListeners = new Set<(state: HealthState) => void>();
type EventCallback = (event: MessageEvent) => void;
const subscribers = new Map<string, Set<EventCallback>>();
// eventType → EventSource へ登録した単一ディスパッチャー。
// 配送経路を eventType ごとに1つへ集約し、発火時に購読者集合を都度参照して全購読者へ配る。
// 同一 eventType のディスパッチャーは1つだけ登録し、多重配送を避ける。
const dispatchers = new Map<string, EventCallback>();

/** SSE 接続を開始する */
export function connect(queryClient: QueryClient): void {
  if (eventSource) return;

  queryClientRef = queryClient;
  lastReceivedAt = Date.now();
  // 接続開始時は "initial" 状態へ戻し、10秒タイマーをセットする
  resetHealthForConnect();

  const url = buildConnectUrl();
  debugLog("sse", "connect", { url, lastEventId });
  const es = new EventSource(url);
  eventSource = es;

  // 接続確立時の処理:
  // 1. サーバー時刻から暫定オフセットを設定 (tRPC レスポンスの RTT/2 補正値で上書きされる)
  // 2. 全クエリーを invalidate して、切断中に取りこぼしたイベントぶんを取り直す
  //    (EventSource は自動再接続するため、再接続時もこのハンドラが再発火する)
  es.addEventListener("connected", (e: MessageEvent) => {
    debugLog("sse", "connected", { lastEventId: e.lastEventId });
    touchReceived();
    captureEventId(e);
    const serverMs = Number(e.data);
    if (serverMs) {
      setServerOffset(serverMs - Date.now());
    }
    void queryClient.invalidateQueries();
  });

  // reset イベント: サーバー側バッファ外れ・再起動などで差分catchupが成立しない場合に送出される。
  // connected と同等に全クエリーを invalidate して整合性を回復する。
  // 受信時点で保持中の lastEventId は破棄し、次回再接続を初回接続扱い（connected経路）に戻す。
  // これにより `reset` ループ（古い lastEventId を送り続けて毎回 reset が返る状態）を避ける。
  es.addEventListener(SSE_EVENTS.reset, () => {
    debugLog("sse", "reset");
    touchReceived();
    lastEventId = null;
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
    const closed = eventSource?.readyState === EventSource.CLOSED;
    debugLog("sse", "error", { readyState: eventSource?.readyState, closed });
    if (closed) {
      forceReconnect();
    }
  });

  // 登録済みイベントのディスパッチャーを設定する。
  // 既存接続のディスパッチャーは EventSource とともに失われるため作り直す。
  dispatchers.clear();
  for (const eventType of subscribers.keys()) {
    ensureDispatcher(eventType as SseEventName);
  }

  startWatchdog();
}

/** SSE 接続を切断する */
export function disconnect(): void {
  debugLog("sse", "disconnect");
  stopWatchdog();
  clearUnhealthyTimer();
  if (eventSource) {
    eventSource.close();
    eventSource = null;
  }
  dispatchers.clear();
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

  // 接続中なら当該 eventType のディスパッチャーを用意する。
  // 未接続時は connect 時に subscribers 全体へ一括登録されるため、ここでは不要。
  ensureDispatcher(eventType);

  return () => {
    callbacks!.delete(callback);
    if (callbacks!.size === 0) {
      subscribers.delete(eventType);
      removeDispatcher(eventType);
    }
  };
}

/**
 * 指定 eventType の受信ディスパッチャーを EventSource へ登録する（未接続・登録済みなら何もしない）。
 *
 * ディスパッチャーは発火時に購読者集合を都度参照して配送するため、購読の増減に追従する。
 * eventType ごとに1つだけ登録することで、同一イベントの多重配送を防ぐ。
 */
function ensureDispatcher(eventType: SseEventName): void {
  if (!eventSource || dispatchers.has(eventType)) return;
  const handler: EventCallback = (e: MessageEvent) => {
    debugLog("sse", "event", { type: eventType, sourceTabId: e.data });
    touchReceived();
    captureEventId(e);
    const callbacks = subscribers.get(eventType);
    if (!callbacks) return;
    for (const cb of callbacks) {
      cb(e);
    }
  };
  dispatchers.set(eventType, handler);
  eventSource.addEventListener(eventType, handler);
}

/** 指定 eventType のディスパッチャーを EventSource から解除する（未登録なら何もしない） */
function removeDispatcher(eventType: SseEventName): void {
  const handler = dispatchers.get(eventType);
  if (!handler) return;
  dispatchers.delete(eventType);
  eventSource?.removeEventListener(eventType, handler);
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

/** 現在の健全性状態を取得する */
export function getHealth(): HealthState {
  return healthState;
}

/** 健全性状態の変化を購読する（戻り値は解除関数） */
export function onHealthChange(cb: (state: HealthState) => void): () => void {
  healthListeners.add(cb);
  return () => healthListeners.delete(cb);
}

/** 受信イベントから lastEventId を取り出して保持する（空文字・欠落は無視） */
function captureEventId(e: MessageEvent): void {
  // MessageEvent.lastEventId は仕様上 string で、SSEに `id:` が無いと空文字
  const id = e.lastEventId;
  if (typeof id === "string" && id !== "") {
    lastEventId = id;
  }
}

/** 接続URLを組み立てる。受信済みIDがあればクエリーパラメータで伝達する */
function buildConnectUrl(): string {
  if (lastEventId === null) return "/api/events";
  return `/api/events?lastEventId=${encodeURIComponent(lastEventId)}`;
}

/**
 * 最終受信時刻を現在時刻で更新する。
 * 健全性状態を `"healthy"` へ遷移させ、不健全判定タイマーを60秒タイマーへリセットする。
 */
function touchReceived(): void {
  lastReceivedAt = Date.now();
  scheduleUnhealthyTimer(HEALTH_RECEIVE_TIMEOUT_MS);
  setHealthState("healthy");
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

/** 接続開始時に健全性状態と不健全判定タイマーを初期化する */
function resetHealthForConnect(): void {
  setHealthState("initial");
  scheduleUnhealthyTimer(HEALTH_INITIAL_TIMEOUT_MS);
}

/** 不健全判定タイマーをセット（既存タイマーがあれば置き換える） */
function scheduleUnhealthyTimer(timeoutMs: number): void {
  clearUnhealthyTimer();
  unhealthyTimer = setTimeout(() => {
    unhealthyTimer = null;
    setHealthState("unhealthy");
  }, timeoutMs);
}

/** 不健全判定タイマーを停止する */
function clearUnhealthyTimer(): void {
  if (unhealthyTimer) {
    clearTimeout(unhealthyTimer);
    unhealthyTimer = null;
  }
}

/** 健全性状態を更新し、変化があればリスナーへ通知する */
function setHealthState(next: HealthState): void {
  if (healthState === next) return;
  debugLog("sse", "health", { from: healthState, to: next });
  healthState = next;
  for (const cb of healthListeners) {
    cb(next);
  }
}

/** 既存接続を破棄して即時再接続する（接続済み QueryClient を再利用する） */
function forceReconnect(): void {
  const client = queryClientRef;
  if (!client) return;
  debugLog("sse", "reconnect");
  disconnect();
  connect(client);
}
