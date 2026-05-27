/**
 * @fileoverview 接続不全の能動検出と回復誘導
 *
 * キャプティブポータル復帰やネットワーク途絶を早期かつ確実に検出するため、
 * SSE受信途絶の監視（`sse-client.ts`）とは独立した能動検出経路をここへ集約する。
 * 検出と同期の役割を分離し、本モジュールは検出と回復誘導だけを担う。
 *
 * ## 検出方式
 *
 * `/healthcheck` へ能動的にfetchし、HTTPステータス200・Content-Typeが
 * `application/json`・JSON本文の `status` 値が `"ok"` の3点が揃った場合のみ健全と判断する。
 * キャプティブポータルはHTTPステータス200で認証用HTMLを返すことがあり、ステータスだけでは
 * 判別できないため、Content-Typeと本文の値まで検査する。
 * 応答待ちにはタイムアウトを設け、キャプティブポータルが応答を遅延させても検出が止まらないようにする。
 *
 * ## 検出トリガー
 *
 * 検出取りこぼしを避けるため、次を起点に能動チェックを実行する。
 *
 * - 定期ポーリング（30秒間隔。非表示タブでは停止し、可視復帰時に即時チェックする）
 * - オンライン復帰（`online` イベント）
 * - SSE不健全遷移（`sse-subscribe.ts` からの通知）
 * - 操作失敗（`query-client.ts` のmutation・queryエラー）
 *
 * ## 検出後の挙動
 *
 * 入力中ユーザーの操作妨害を避けるため、検知時の挙動を入力中の有無で分岐する。
 *
 * - 非入力中: 即時に `location.reload()` を呼ぶ。再読み込み先が認証画面への導線を兼ねる。
 * - 入力中:   `connectivityState.pendingReload` を真にしてバナーで案内する。
 *             入力を保ったまま、接続回復を検知した時点でバナーを自動解除する。
 */

// ポーリング周期（ms）。判定基盤の `/healthcheck` は認証もDBアクセスも持たず軽量で、
// サーバー側 SSE heartbeat 周期30秒と同等の負荷に収まるため、同等の30秒間隔とする。
const POLL_INTERVAL_MS = 30_000;

// 能動チェックの応答待ちタイムアウト（ms）。キャプティブポータルの応答遅延で検出が止まらないようにする。
const HEALTHCHECK_TIMEOUT_MS = 5_000;

const state = $state({
  pendingReload: false,
});

/** バナー側から購読するリアクティブ状態 */
export const connectivityState = state;

let pollTimer: ReturnType<typeof setInterval> | null = null;
let visibilityHandler: (() => void) | null = null;
let onlineHandler: (() => void) | null = null;
let watching = false;
// 複数トリガーがほぼ同時に発火しうるため、能動チェックの重複起動を防ぐ
let checking = false;

/** 能動検出監視を開始する（多重起動はno-op） */
export function startConnectivityWatch(): void {
  if (watching) return;
  watching = true;
  visibilityHandler = handleVisibilityChange;
  onlineHandler = () => {
    void checkConnectivity();
  };
  document.addEventListener("visibilitychange", visibilityHandler);
  window.addEventListener("online", onlineHandler);
  if (document.visibilityState !== "hidden") {
    startPolling();
  }
}

/** 能動検出監視を停止する（多重停止はno-op） */
export function stopConnectivityWatch(): void {
  if (!watching) return;
  watching = false;
  stopPolling();
  if (visibilityHandler) {
    document.removeEventListener("visibilitychange", visibilityHandler);
    visibilityHandler = null;
  }
  if (onlineHandler) {
    window.removeEventListener("online", onlineHandler);
    onlineHandler = null;
  }
}

/**
 * 接続を能動チェックし、不健全なら回復誘導、健全ならバナーを解除する。
 *
 * ポーリング・可視復帰・オンライン復帰に加え、SSE不健全遷移・操作失敗からの
 * 前倒しトリガーとしても呼ばれる。`fetchFn` はテスト用の差し替え口で、本番では既定の `fetch` を使う。
 */
export async function checkConnectivity(
  fetchFn: typeof fetch = fetch,
): Promise<void> {
  if (checking) return;
  checking = true;
  try {
    if (await isHealthy(fetchFn)) {
      // 回復検知: バナー待機中なら自動解除する
      state.pendingReload = false;
    } else {
      triggerReload();
    }
  } finally {
    checking = false;
  }
}

// 非表示中はポーリングを停止し、可視復帰時はポーリングを再開して即時チェックする（無駄な通信を抑える）
function handleVisibilityChange(): void {
  if (document.visibilityState === "hidden") {
    stopPolling();
  } else {
    startPolling();
    void checkConnectivity();
  }
}

function startPolling(): void {
  if (pollTimer) return;
  pollTimer = setInterval(() => {
    void checkConnectivity();
  }, POLL_INTERVAL_MS);
}

function stopPolling(): void {
  if (pollTimer) {
    clearInterval(pollTimer);
    pollTimer = null;
  }
}

/**
 * `/healthcheck` の応答が健全条件を満たすか判定する。
 *
 * タイムアウト・ネットワークエラー・JSON解析失敗はすべて不健全とみなす。
 */
async function isHealthy(fetchFn: typeof fetch): Promise<boolean> {
  try {
    const res = await fetchFn("/healthcheck", {
      cache: "no-store",
      signal: AbortSignal.timeout(HEALTHCHECK_TIMEOUT_MS),
    });
    if (res.status !== 200) return false;
    const contentType = res.headers.get("Content-Type") ?? "";
    if (!contentType.includes("application/json")) return false;
    const body = (await res.json()) as { status?: unknown };
    return body.status === "ok";
  } catch {
    return false;
  }
}

/** 接続不全検知時に呼び出され、入力中ならバナー表示、非入力中なら即リロードする */
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
