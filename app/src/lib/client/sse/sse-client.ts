import { setServerOffset } from "#lib/client/timers/time-sync.ts";

import type { QueryClient } from "@tanstack/svelte-query";
import { SSE_EVENTS, type SseEventName } from "#lib/sse-events.ts";
import { debugLog } from "#lib/client/debug-log.ts";

const WATCHDOG_INTERVAL_MS = 30_000;
const RECEIVE_TIMEOUT_MS = 75_000;

const HEALTH_INITIAL_TIMEOUT_MS = 10_000;
const HEALTH_RECEIVE_TIMEOUT_MS = 60_000;

export type HealthState = "initial" | "healthy" | "unhealthy";

let eventSource: EventSource | null = null;
let queryClientRef: QueryClient | null = null;
let lastReceivedAt = 0;
let watchdogTimer: ReturnType<typeof setInterval> | null = null;
let unhealthyTimer: ReturnType<typeof setTimeout> | null = null;
let lastEventId: string | null = null;
let healthState: HealthState = "initial";
const healthListeners = new Set<(state: HealthState) => void>();
type EventCallback = (event: MessageEvent) => void;
const subscribers = new Map<string, Set<EventCallback>>();
const dispatchers = new Map<string, EventCallback>();

export function connect(queryClient: QueryClient): void {
  if (eventSource) return;

  queryClientRef = queryClient;
  lastReceivedAt = Date.now();
  resetHealthForConnect();

  const url = buildConnectUrl();
  debugLog("sse", "connect", { url, lastEventId });
  const es = new EventSource(url);
  eventSource = es;

  // 接続確立時の処理:
  // 1. サーバー時刻から暫定オフセットを設定 (tRPC レスポンスの RTT/2 補正値で上書きされる)
  // 2. 全クエリーをリセットし、差分カーソルを破棄して切断中の変更を全件取り直す
  //    (EventSource は自動再接続するため、再接続時もこのハンドラが再発火する)
  es.addEventListener(SSE_EVENTS.connected, (e: MessageEvent) => {
    debugLog("sse", "connected", { lastEventId: e.lastEventId });
    touchReceived();
    captureEventId(e);
    const serverMs = Number(e.data);
    if (serverMs) {
      setServerOffset(serverMs - Date.now());
    }
    void queryClient.resetQueries();
  });

  es.addEventListener(SSE_EVENTS.reset, () => {
    debugLog("sse", "reset");
    touchReceived();
    lastEventId = null;
    void queryClient.resetQueries();
  });

  es.addEventListener(SSE_EVENTS.heartbeat, () => {
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

  dispatchers.clear();
  for (const eventType of subscribers.keys()) {
    ensureDispatcher(eventType as SseEventName);
  }

  startWatchdog();
}

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

  ensureDispatcher(eventType);

  return () => {
    callbacks!.delete(callback);
    if (callbacks!.size === 0) {
      subscribers.delete(eventType);
      removeDispatcher(eventType);
    }
  };
}

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

function removeDispatcher(eventType: SseEventName): void {
  const handler = dispatchers.get(eventType);
  if (!handler) return;
  dispatchers.delete(eventType);
  eventSource?.removeEventListener(eventType, handler);
}

export function checkConnection(): void {
  if (!eventSource) return;
  const elapsed = Date.now() - lastReceivedAt;
  if (elapsed >= RECEIVE_TIMEOUT_MS) {
    forceReconnect();
  }
}

export function getHealth(): HealthState {
  return healthState;
}

export function onHealthChange(cb: (state: HealthState) => void): () => void {
  healthListeners.add(cb);
  return () => healthListeners.delete(cb);
}

function captureEventId(e: MessageEvent): void {
  // MessageEvent.lastEventId は仕様上 string で、SSEに `id:` が無いと空文字
  const id = e.lastEventId;
  if (typeof id === "string" && id !== "") {
    lastEventId = id;
  }
}

function buildConnectUrl(): string {
  if (lastEventId === null) return "/api/events";
  return `/api/events?lastEventId=${encodeURIComponent(lastEventId)}`;
}

function touchReceived(): void {
  lastReceivedAt = Date.now();
  scheduleUnhealthyTimer(HEALTH_RECEIVE_TIMEOUT_MS);
  setHealthState("healthy");
}

function startWatchdog(): void {
  if (watchdogTimer) return;
  watchdogTimer = setInterval(checkConnection, WATCHDOG_INTERVAL_MS);
}

function stopWatchdog(): void {
  if (watchdogTimer) {
    clearInterval(watchdogTimer);
    watchdogTimer = null;
  }
}

function resetHealthForConnect(): void {
  setHealthState("initial");
  scheduleUnhealthyTimer(HEALTH_INITIAL_TIMEOUT_MS);
}

function scheduleUnhealthyTimer(timeoutMs: number): void {
  clearUnhealthyTimer();
  unhealthyTimer = setTimeout(() => {
    unhealthyTimer = null;
    setHealthState("unhealthy");
  }, timeoutMs);
}

function clearUnhealthyTimer(): void {
  if (unhealthyTimer) {
    clearTimeout(unhealthyTimer);
    unhealthyTimer = null;
  }
}

function setHealthState(next: HealthState): void {
  if (healthState === next) return;
  debugLog("sse", "health", { from: healthState, to: next });
  healthState = next;
  for (const cb of healthListeners) {
    cb(next);
  }
}

function forceReconnect(): void {
  const client = queryClientRef;
  if (!client) return;
  debugLog("sse", "reconnect");
  disconnect();
  connect(client);
}
