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
 * - 到達不能の間の再判定（2秒間隔。可視の間だけ続け、健全か横取りの判定で止める）
 *
 * ## 検出後の挙動
 *
 * 判定結果（`classifyHealth`）の区分で挙動を分ける。
 *
 * - 到達不能（通信エラー・タイムアウト・511以外の5xx）: 再読み込みせず、2秒間隔で再判定する。
 *   到達不能が6秒以上続いた場合だけ`connectivityState.notice`を`"unreachable"`にしてバナーで案内し、健全の判定で自動解除する。
 *   AndroidのPWAで別アプリから戻った直後は通信が数秒で戻ることが多く、短い通信断ではバナーを出さずに済ませるためである。
 *   通信断の間に再読み込みすると、画面の取得に失敗してService Workerのオフライン画面へ移り、表示中の画面を失うため、
 *   このバナーは再読み込みを促さない。
 * - 応答の横取り（キャプティブポータルなど）: 非入力中は即時に`location.reload()`を呼び、再読み込み先で認証画面へ誘導する。
 *   入力中は操作妨害を避けるため、`notice`を`"reload-required"`にして再読み込みボタン付きのバナーで案内する。
 */

import { debugLog } from "#lib/client/debug-log.ts";
import {
  classifyHealth,
  startConnectivityTriggers,
} from "#lib/client/sse/connectivity-check.js";
import { isUserBusy } from "#lib/client/ui/user-busy.ts";

// 別アプリからの復帰直後に通信が戻った時点を早く捉えるため、到達不能の間は定期ポーリングより短い間隔で再判定する。
export const UNREACHABLE_RECHECK_INTERVAL_MS = 2_000;

// 復帰直後の短い通信断でバナーを出さないための猶予。この時間を超えて到達不能が続いた場合だけ案内する。
export const UNREACHABLE_NOTICE_DELAY_MS = 6_000;

/**
 * 接続不全の案内の種類。
 *
 * - `"none"`: 案内しない
 * - `"unreachable"`: サーバーへ到達できない。回復を検知すると自動で消え、再読み込みは不要
 * - `"reload-required"`: 応答が横取りされている（入力中のため自動再読み込みを見送った）。再読み込みで認証画面へ進む
 */
export type ConnectivityNotice = "none" | "unreachable" | "reload-required";

export const connectivityState = $state<{ notice: ConnectivityNotice }>({
  notice: "none",
});

let stopTriggers: (() => void) | null = null;
let watching = false;
// 複数トリガーがほぼ同時に発火しうるため、能動チェックの重複起動を防ぐ
let checking = false;
// 到達不能が続いている開始時刻（到達不能でない間はundefined）
let unreachableSince: number | undefined;
let recheckTimer: ReturnType<typeof setTimeout> | undefined;

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
  clearRecheck();
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
      // 回復検知: 案内を自動解除する
      unreachableSince = undefined;
      clearRecheck();
      connectivityState.notice = "none";
    } else if (health === "unreachable") {
      handleUnreachable(fetchFn);
    } else {
      unreachableSince = undefined;
      clearRecheck();
      triggerReload();
    }
  } finally {
    checking = false;
  }
}

/** 到達不能の継続時間で案内を出すか決め、回復を早く捉えるための再判定を予約する */
function handleUnreachable(fetchFn: typeof fetch): void {
  // 非表示の間は再判定を止め、継続時間も数え直す。可視復帰のトリガーが改めて判定し、
  // 非表示の間の通信断を復帰直後の猶予に含めない（復帰した瞬間にバナーが出ないようにするため）。
  if (document.visibilityState === "hidden") {
    unreachableSince = undefined;
    clearRecheck();
    return;
  }
  const now = Date.now();
  unreachableSince ??= now;
  if (now - unreachableSince >= UNREACHABLE_NOTICE_DELAY_MS) {
    debugLog("connectivity", "recover", { mode: "banner" });
    connectivityState.notice = "unreachable";
  }
  clearRecheck();
  recheckTimer = setTimeout(() => {
    recheckTimer = undefined;
    void checkConnectivity(fetchFn);
  }, UNREACHABLE_RECHECK_INTERVAL_MS);
}

function clearRecheck(): void {
  if (recheckTimer !== undefined) {
    clearTimeout(recheckTimer);
    recheckTimer = undefined;
  }
}

/** 応答の横取りを検知した時に呼び出され、入力中ならバナー表示、非入力中なら即リロードする */
function triggerReload(): void {
  if (isUserBusy()) {
    debugLog("connectivity", "recover", { mode: "banner" });
    connectivityState.notice = "reload-required";
  } else {
    debugLog("connectivity", "recover", { mode: "reload" });
    // eslint-disable-next-line no-restricted-syntax -- 応答の横取りのときだけ再読み込みし、到達不能では呼ばない。再読み込み先でキャプティブポータルの認証画面へ誘導する
    location.reload();
  }
}
