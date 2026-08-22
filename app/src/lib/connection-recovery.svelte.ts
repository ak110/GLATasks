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

import { debugLog } from "./debug-log";
import { isHealthy, startConnectivityTriggers } from "./connectivity-check.js";

const state = $state({
  pendingReload: false,
});

/** バナー側から購読するリアクティブ状態 */
export const connectivityState = state;

let stopTriggers: (() => void) | null = null;
let watching = false;
// 複数トリガーがほぼ同時に発火しうるため、能動チェックの重複起動を防ぐ
let checking = false;

/** 能動検出監視を開始する（多重起動はno-op） */
export function startConnectivityWatch(): void {
  if (watching) return;
  watching = true;
  stopTriggers = startConnectivityTriggers(() => {
    void checkConnectivity();
  });
}

/** 能動検出監視を停止する（多重停止はno-op） */
export function stopConnectivityWatch(): void {
  if (!watching) return;
  watching = false;
  stopTriggers?.();
  stopTriggers = null;
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
    const healthy = await isHealthy(fetchFn);
    debugLog("connectivity", "check", { healthy });
    if (healthy) {
      // 回復検知: バナー待機中なら自動解除する
      state.pendingReload = false;
    } else {
      triggerReload();
    }
  } finally {
    checking = false;
  }
}

/** 接続不全検知時に呼び出され、入力中ならバナー表示、非入力中なら即リロードする */
function triggerReload(): void {
  if (isUserBusy()) {
    debugLog("connectivity", "recover", { mode: "banner" });
    state.pendingReload = true;
  } else {
    debugLog("connectivity", "recover", { mode: "reload" });
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
