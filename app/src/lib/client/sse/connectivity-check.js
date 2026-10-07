/**
 * @fileoverview 接続判定と能動検出トリガーの共有モジュール
 *
 * アプリ本体とオフライン画面の判定条件・検出契機を一元化する。
 * オフライン画面へはこのファイルが ?raw でインライン展開されるため、外部依存を持たない。
 */

// 判定基盤は軽量な /healthcheck のため、サーバー側 SSE heartbeat と同じ30秒間隔とする。
export const POLL_INTERVAL_MS = 30_000;

// キャプティブポータル等の応答遅延で検出が停止しないよう5秒で打ち切る。
export const HEALTHCHECK_TIMEOUT_MS = 5_000;

/**
 * `/healthcheck` の応答が健全条件を満たすか判定する。
 *
 * @param {typeof fetch} fetchFn 判定に使うfetch関数
 * @returns {Promise<boolean>} 健全な応答であるか
 */
export async function isHealthy(fetchFn = fetch) {
  try {
    const response = await fetchFn("/healthcheck", {
      cache: "no-store",
      signal: AbortSignal.timeout(HEALTHCHECK_TIMEOUT_MS),
    });
    if (response.status !== 200) return false;
    const contentType = response.headers.get("Content-Type") ?? "";
    if (!contentType.includes("application/json")) return false;
    const body = await response.json();
    return body.status === "ok";
  } catch {
    return false;
  }
}

/** @type {(() => void) | null} */
let activeCleanup = null;

/**
 * 接続判定を起動する契機を登録する（多重起動はno-op）。
 * 非表示中はポーリングを停止し、可視復帰時は即時にコールバックを呼ぶ。
 *
 * @param {() => void | Promise<void>} onTrigger 接続判定を起動するコールバック
 * @returns {() => void} 全契機を解除する停止関数
 */
export function startConnectivityTriggers(onTrigger) {
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
    pollTimer = setInterval(() => void onTrigger(), POLL_INTERVAL_MS);
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
  if (document.visibilityState !== "hidden") startPolling();
  activeCleanup = cleanup;
  return cleanup;
}
