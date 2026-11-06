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
 * 判定結果（`classifyHealth`）の区分で挙動を分ける。
 *
 * - 到達不能（通信エラー・タイムアウト・511以外の5xx）: 再読み込みせず、`connectivityState.pendingReload`を真にしてバナーで案内する。
 *   通信断の間に再読み込みすると、画面の取得に失敗してService Workerのオフライン画面へ移り、表示中の画面を失うためである
 *   （AndroidのPWAで復帰直後に通信が再開しきっていない場合など）。接続回復を検知した時点でバナーを自動解除する。
 * - 応答の横取り（キャプティブポータルなど）: 非入力中は即時に`location.reload()`を呼び、再読み込み先で認証画面へ誘導する。
 *   入力中は操作妨害を避けるためバナーで案内する。
 */

import { debugLog } from "#lib/client/debug-log.ts";
import {
  classifyHealth,
  startConnectivityTriggers,
} from "#lib/client/sse/connectivity-check.js";

export const connectivityState = $state({
  pendingReload: false,
});

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
    const health = await classifyHealth(fetchFn);
    debugLog("connectivity", "check", { health });
    if (health === "healthy") {
      // 回復検知: バナー待機中なら自動解除する
      connectivityState.pendingReload = false;
    } else if (health === "unreachable") {
      debugLog("connectivity", "recover", { mode: "banner" });
      connectivityState.pendingReload = true;
    } else {
      triggerReload();
    }
  } finally {
    checking = false;
  }
}

/** 応答の横取りを検知した時に呼び出され、入力中ならバナー表示、非入力中なら即リロードする */
function triggerReload(): void {
  if (isUserBusy()) {
    debugLog("connectivity", "recover", { mode: "banner" });
    connectivityState.pendingReload = true;
  } else {
    debugLog("connectivity", "recover", { mode: "reload" });
    // eslint-disable-next-line no-restricted-syntax -- 応答の横取りのときだけ再読み込みし、到達不能では呼ばない。再読み込み先でキャプティブポータルの認証画面へ誘導する
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
  if (
    document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')
  )
    return true;
  return false;
}
