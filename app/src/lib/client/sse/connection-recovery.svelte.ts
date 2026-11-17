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
 *   このバナーは再読み込みを促さない。HTTPSの通信自体を遮断する認証画面は通信エラーとなり到達不能と区別できないため、
 *   このバナーにも「認証画面を開く」（下記の`openAuthWindow`）を置く。
 * - 応答の横取り（キャプティブポータルのリダイレクトなど）: まず認証画面を非表示のiframeで読み込み、利用者の入力なしで通過するかを試す
 *   （`silent-pass.ts`）。通過して健全に戻れば、画面を遷移せずに案内を消し、`CONNECTIVITY_RECOVERED_EVENT`で再取得を促す。
 *   通過しない場合と、直近に通過を試して失敗した場合は次へ進む。
 *   非入力中は即時に`location.reload()`を呼び、再読み込み先で認証画面へ誘導する。
 *   入力中は操作妨害を避けるため、`notice`を`"reload-required"`にして再読み込みボタンと「認証画面を開く」ボタン付きのバナーで案内する。
 *   「認証画面を開く」（`openAuthWindow`）は同一オリジンの`/healthcheck`を別ウィンドウで開く。横取りする側がこの通信も差し替えるため、
 *   別ウィンドウに認証画面が表示され、入力中の画面を残したまま認証できる。開いている間は2秒間隔で判定し直し、
 *   健全で別ウィンドウを閉じて案内を消す。30秒間隔のポーリングを待つと、認証後もバナーが最大30秒残るためである。
 *   利用者が別ウィンドウを閉じたら判定を止め、案内は残す。ポップアップの阻止を避けるため、別ウィンドウは利用者のクリックでだけ開く。
 */

import { debugLog } from "#lib/client/debug-log.ts";
import {
  classifyHealth,
  startConnectivityTriggers,
} from "#lib/client/sse/connectivity-check.js";
import { isUserBusy } from "#lib/client/ui/user-busy.ts";
import { loadHiddenFrame } from "#lib/client/sse/silent-pass.ts";

/** 横取りの自動通過で画面を遷移せずに回復した時に`window`へ送るイベント名。再取得を担う側が購読する */
export const CONNECTIVITY_RECOVERED_EVENT = "glatasks:connectivity-recovered";

// 自動で通過しない認証画面へiframeの読み込みを繰り返さないよう、失敗後はこの間だけ通過を試さない
export const SILENT_PASS_RETRY_INTERVAL_MS = 60_000;

/** 接続の判定区分（健全・到達不能・応答の横取り） */
export type Health = Awaited<ReturnType<typeof classifyHealth>>;

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
// 複数トリガーがほぼ同時に発火しうるため、能動チェックの重複起動を防ぎ、実行中の判定結果を共有する
let inflight: Promise<Health> | undefined;
// 到達不能が続いている開始時刻（到達不能でない間はundefined）
let unreachableSince: number | undefined;
let recheckTimer: ReturnType<typeof setTimeout> | undefined;
// 「認証画面を開く」で開いた別ウィンドウと、その間の再判定。到達不能の再判定とは停止条件が異なるため分ける。
let authWindow: Window | undefined;
let authRecheckTimer: ReturnType<typeof setTimeout> | undefined;
// 直近に自動通過を試して失敗した時刻（成功または未試行ならundefined）
let silentPassFailedAt: number | undefined;

/** 能動検出監視を開始する（多重起動はno-op） */
export function startConnectivityWatch(): void {
  if (watching) return;
  watching = true;
  stopTriggers = startConnectivityTriggers(() => {
    void checkConnectivity();
  });
  document.addEventListener("visibilitychange", handleVisibilityChange);
}

/** 能動検出監視を停止する（多重停止はno-op） */
export function stopConnectivityWatch(): void {
  if (!watching) return;
  watching = false;
  stopTriggers?.();
  stopTriggers = null;
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  clearRecheck();
  clearAuthRecheck();
}

/**
 * 非表示へ移った時点で、到達不能の継続時間・再判定・到達不能の案内を打ち切る。
 *
 * 判定の完了を待たずに打ち切るのは、非表示の間に予約済みの再判定が通信したり、
 * 非表示前の継続時間や案内が復帰後へ持ち越されたりしないようにするためである。
 * 復帰後は可視復帰のトリガーが改めて判定し、到達不能が続けば新しい可視期間の猶予の後に案内する。
 * 応答の横取りの案内は再読み込みが必要な状態を示すため、非表示の期間をまたいでも残す。
 */
function handleVisibilityChange(): void {
  if (document.visibilityState !== "hidden") return;
  unreachableSince = undefined;
  clearRecheck();
  if (connectivityState.notice === "unreachable") {
    connectivityState.notice = "none";
  }
}

/**
 * 接続を能動チェックし、不健全なら回復誘導、健全ならバナーを解除する。
 *
 * ポーリング・可視復帰・オンライン復帰に加え、SSE不健全遷移・操作失敗からの
 * 前倒しトリガーとしても呼ばれる。判定区分を返し、判定の実行中に重ねて呼ばれた場合は同じ判定の結果を返す。
 * 操作失敗の通知側は、この結果で応答の横取り（再読み込みか案内へ進む）を知り、個別のエラー通知を省く。
 * `fetchFn` はテスト用の差し替え口で、本番では既定の `fetch` を使う。
 */
export async function checkConnectivity(
  fetchFn: typeof fetch = fetch,
): Promise<Health> {
  inflight ??= runCheck(fetchFn).finally(() => {
    inflight = undefined;
  });
  return inflight;
}

async function runCheck(fetchFn: typeof fetch): Promise<Health> {
  const health = await classifyHealth(fetchFn);
  debugLog("connectivity", "check", { health });
  if (health === "healthy") {
    // 回復検知: 案内を自動解除する
    unreachableSince = undefined;
    clearRecheck();
    closeAuthWindow();
    connectivityState.notice = "none";
  } else if (health === "unreachable") {
    handleUnreachable(fetchFn);
  } else {
    unreachableSince = undefined;
    clearRecheck();
    const afterPass = await trySilentPass(fetchFn);
    if (afterPass === "healthy") {
      closeAuthWindow();
      connectivityState.notice = "none";
      window.dispatchEvent(new Event(CONNECTIVITY_RECOVERED_EVENT));
    } else if (afterPass === "unreachable") {
      // 通過を試す間に通信が途絶した。到達不能では再読み込みせず表示中の画面を守る
      handleUnreachable(fetchFn);
      return afterPass;
    } else {
      triggerReload();
    }
  }
  return health;
}

/**
 * 横取りした認証画面を非表示で読み込み、読み込み後の判定区分を返す。
 *
 * 直近に通過を試して失敗した場合は読み込まずに`"intercepted"`を返す。
 */
async function trySilentPass(fetchFn: typeof fetch): Promise<Health> {
  if (
    silentPassFailedAt !== undefined &&
    Date.now() - silentPassFailedAt < SILENT_PASS_RETRY_INTERVAL_MS
  ) {
    return "intercepted";
  }
  // キャッシュを避けるため毎回異なるURLで読み込む
  await loadHiddenFrame(`/healthcheck?silent-pass=${Date.now()}`);
  const health = await classifyHealth(fetchFn);
  debugLog("connectivity", "silent-pass", { health });
  silentPassFailedAt = health === "intercepted" ? Date.now() : undefined;
  return health;
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

/**
 * 認証画面を別ウィンドウで開き、認証の完了（健全の判定）を短い間隔で待つ。
 *
 * ポップアップが阻止されて開けなかった場合は再判定を始めず、バナーの再読み込みボタンで回復できる状態を保つ。
 * `fetchFn` はテスト用の差し替え口で、本番では既定の `fetch` を使う。
 */
export function openAuthWindow(fetchFn: typeof fetch = fetch): void {
  if (authWindow && !authWindow.closed) {
    authWindow.focus();
    return;
  }
  authWindow = window.open("/healthcheck", "glatasks-auth") ?? undefined;
  debugLog("connectivity", "auth-window", { opened: authWindow !== undefined });
  if (authWindow) scheduleAuthRecheck(fetchFn);
}

function scheduleAuthRecheck(fetchFn: typeof fetch): void {
  clearAuthRecheck();
  authRecheckTimer = setTimeout(() => {
    authRecheckTimer = undefined;
    if (!authWindow || authWindow.closed) {
      // 利用者が別ウィンドウを閉じた。認証を続ける意思が無いため判定を止め、案内は残す
      authWindow = undefined;
      return;
    }
    void checkConnectivity(fetchFn).then(() => {
      if (authWindow) scheduleAuthRecheck(fetchFn);
    });
  }, UNREACHABLE_RECHECK_INTERVAL_MS);
}

function clearAuthRecheck(): void {
  if (authRecheckTimer !== undefined) {
    clearTimeout(authRecheckTimer);
    authRecheckTimer = undefined;
  }
}

function closeAuthWindow(): void {
  clearAuthRecheck();
  if (authWindow && !authWindow.closed) authWindow.close();
  authWindow = undefined;
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
