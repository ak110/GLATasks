/**
 * @fileoverview キャプティブポータル検知時の自動リロード監視
 *
 * フリーWiFiのキャプティブポータル下では、認証セッション期限切れで
 * ログイン画面へリダイレクトされ、SSEの自動再接続も成立しない。
 * 本モジュールはSSEとは独立した検出経路として、ヘルスチェックエンドポイントへ
 * 定期fetchを行い、応答が成功条件を満たさない時点で即時にページをリロードする。
 * リロードは認証画面への遷移を兼ねる導線となる。
 *
 * 入力中ユーザーへの操作妨害を避けるため、検知時は入力中の有無で動作を分岐する。
 *
 * - 非入力中: 即時に `location.reload()` を呼ぶ
 * - 入力中:   `connectivityState.pendingReload` を真にしてバナーから手動リロードを促す
 */

// サーバー側 SSE heartbeat 周期 30秒の倍を採用し、既存ウォッチドッグと役割を分離する
const POLL_INTERVAL_MS = 60_000;

const state = $state({
  pendingReload: false,
});

/** バナー側から購読するリアクティブ状態 */
export const connectivityState = state;

let pollingTimer: ReturnType<typeof setInterval> | null = null;
let visibilityHandler: (() => void) | null = null;
let running = false;

/** 監視を開始する（多重起動はno-op） */
export function start(): void {
  if (running) return;
  running = true;
  state.pendingReload = false;
  visibilityHandler = handleVisibilityChange;
  document.addEventListener("visibilitychange", visibilityHandler);
  if (document.visibilityState !== "hidden") {
    startPolling();
  }
}

/** 監視を停止する（多重停止はno-op） */
export function stop(): void {
  if (!running) return;
  running = false;
  stopPolling();
  if (visibilityHandler) {
    document.removeEventListener("visibilitychange", visibilityHandler);
    visibilityHandler = null;
  }
  state.pendingReload = false;
}

// 非表示中はポーリングを停止し、可視復帰した瞬間に1回ヘルスチェックを即時実行する。
// 既存SSEクライアントの visibilitychange ハンドラと同等の前倒し判定を採る。
function handleVisibilityChange(): void {
  if (document.visibilityState === "hidden") {
    stopPolling();
  } else {
    startPolling();
    void checkHealth();
  }
}

function startPolling(): void {
  if (pollingTimer) return;
  pollingTimer = setInterval(() => {
    void checkHealth();
  }, POLL_INTERVAL_MS);
}

function stopPolling(): void {
  if (pollingTimer) {
    clearInterval(pollingTimer);
    pollingTimer = null;
  }
}

async function checkHealth(): Promise<void> {
  const ok = await fetchHealth();
  if (!ok) {
    triggerReload();
  }
}

// キャプティブポータルが200でHTMLを返すケースに対応するため、HTTPステータス・
// Content-Type・JSONの`status`値の3点で判定する。
async function fetchHealth(): Promise<boolean> {
  try {
    const res = await fetch("/healthcheck", { cache: "no-store" });
    if (res.status !== 200) return false;
    const contentType = res.headers.get("Content-Type") ?? "";
    if (!contentType.includes("application/json")) return false;
    const body = (await res.json()) as { status?: unknown };
    return body.status === "ok";
  } catch {
    return false;
  }
}

function triggerReload(): void {
  if (isUserBusy()) {
    state.pendingReload = true;
  } else {
    location.reload();
  }
}

function isUserBusy(): boolean {
  const active = document.activeElement;
  if (active) {
    const tag = active.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
    if ((active as HTMLElement).isContentEditable) return true;
  }
  if (document.querySelector('[role="dialog"][aria-modal="true"]')) return true;
  return false;
}
