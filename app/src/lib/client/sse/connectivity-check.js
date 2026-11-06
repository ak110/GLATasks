/**
 * @fileoverview 接続判定と能動検出トリガーの共有モジュール
 *
 * アプリ本体とオフライン画面の判定条件・検出契機を一元化する。
 * オフライン画面へはこのファイルが ?raw でインライン展開されるため、外部依存を持たない。
 */

// 判定基盤は軽量な /healthcheck のため、サーバー側 SSE heartbeat と同じ30秒間隔とする。
export const POLL_INTERVAL_MS = 30_000;

// オフライン画面は表示中の画面を持たないため、回復後すぐ戻れるよう短い間隔で判定する。
// 間隔は通信断の長さによらず伸ばさない（長い通信断の後の回復も5秒程度で検出するため）。
export const OFFLINE_POLL_INTERVAL_MS = 5_000;

// キャプティブポータル等の応答遅延で検出が停止しないよう5秒で打ち切る。
export const HEALTHCHECK_TIMEOUT_MS = 5_000;

/**
 * `/healthcheck` の応答を3区分に判定する。条件は上から順に評価し、1つの応答を1区分だけへ入れる。
 *
 * - `"healthy"`: HTTP 200・`application/json`・本文の`status`が`"ok"`
 * - `"unreachable"`: 通信エラー・タイムアウト（`fetch`の例外）、511を除く5xx。
 *   再読み込みしても画面を取得できず、Service Workerのオフライン画面かエラー画面へ移るため、再読み込みの理由にしない
 * - `"intercepted"`: 上記以外。511（キャプティブポータル用）、5xx・1xx以外の非200、200の非JSONや`status`不一致、本文の解析失敗。
 *   キャプティブポータルなどが応答を横取りした状態で、再読み込みすると認証画面へ届く
 *
 * @param {typeof fetch} fetchFn 判定に使うfetch関数
 * @returns {Promise<"healthy" | "unreachable" | "intercepted">} 判定結果
 */
export async function classifyHealth(fetchFn = fetch) {
  /** @type {Response} */
  let response;
  try {
    response = await fetchFn("/healthcheck", {
      cache: "no-store",
      signal: AbortSignal.timeout(HEALTHCHECK_TIMEOUT_MS),
    });
  } catch {
    return "unreachable";
  }
  if (response.status >= 500 && response.status !== 511) return "unreachable";
  if (response.status !== 200) return "intercepted";
  const contentType = response.headers.get("Content-Type") ?? "";
  if (!contentType.includes("application/json")) return "intercepted";
  /** @type {unknown} */
  let text;
  try {
    text = await response.text();
  } catch {
    // ヘッダー受信後に本文の読み取りが途切れた場合は通信断として扱う
    return "unreachable";
  }
  try {
    const body = JSON.parse(/** @type {string} */ (text));
    return body?.status === "ok" ? "healthy" : "intercepted";
  } catch {
    return "intercepted";
  }
}

/** @type {(() => void) | null} */
let activeCleanup = null;

/**
 * 接続判定を起動する契機を登録する（多重起動はno-op）。
 * 非表示中はポーリングを停止し、可視復帰時は即時にコールバックを呼ぶ。
 *
 * @param {() => void | Promise<void>} onTrigger 接続判定を起動するコールバック
 * @param {{ intervalMs?: number, immediate?: boolean }} [options]
 *   `intervalMs`はポーリング間隔（既定はアプリ本体の30秒）、`immediate`は登録直後（可視の場合）に1回呼ぶか
 * @returns {() => void} 全契機を解除する停止関数
 */
export function startConnectivityTriggers(
  onTrigger,
  { intervalMs = POLL_INTERVAL_MS, immediate = false } = {},
) {
  if (activeCleanup) return () => {};

  /** @type {ReturnType<typeof setInterval> | null} */
  let pollTimer = null;
  const onlineHandler = () => void onTrigger();
  const visibilityHandler = () => {
    if (document.visibilityState === "hidden") {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = null;
      }
      return;
    }
    startPolling();
    void onTrigger();
  };
  const startPolling = () => {
    if (pollTimer) return;
    pollTimer = setInterval(() => void onTrigger(), intervalMs);
  };
  const cleanup = () => {
    if (pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
    document.removeEventListener("visibilitychange", visibilityHandler);
    window.removeEventListener("online", onlineHandler);
    if (activeCleanup === cleanup) activeCleanup = null;
  };

  document.addEventListener("visibilitychange", visibilityHandler);
  window.addEventListener("online", onlineHandler);
  activeCleanup = cleanup;
  if (document.visibilityState !== "hidden") {
    startPolling();
    if (immediate) void onTrigger();
  }
  return cleanup;
}
