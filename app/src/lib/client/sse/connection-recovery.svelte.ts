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
 *   未保存の入力を退避できる場合は即時に`location.reload()`を呼び、再読み込み先で認証画面へ誘導する。
 *   退避できない場合は入力を失わないよう、`notice`を`"reload-required"`にして再読み込みボタンと「認証画面を開く」ボタン付きのバナーで案内する。
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
import { saveRecoveryDrafts } from "#lib/client/ui/user-busy.ts";
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
 * - `"reload-required"`: 応答が横取りされている（入力を退避できないため自動再読み込みを見送った）。再読み込みで認証画面へ進む
 */
export type ConnectivityNotice = "none" | "unreachable" | "reload-required";

export const connectivityState = $state<{ notice: ConnectivityNotice }>({
  notice: "none",
});

type RecheckTimer = ReturnType<typeof setTimeout>;
type ConnectionPhase =
  | { phase: "healthy" }
  | { phase: "unreachable"; since: number; timer: RecheckTimer }
  | { phase: "intercepted" };
type AuthWatch = { phase: "monitoring"; window: Window; timer?: RecheckTimer };

let connection: ConnectionPhase = { phase: "healthy" };
let authWatch: { phase: "closed" } | AuthWatch = { phase: "closed" };
let watch:
  { phase: "manual" | "stopped" } | { phase: "watching"; stop: () => void } = {
  phase: "manual",
};
let inflight: Promise<Health> | undefined;
let generation = 0;
let silentPassFailedAt: number | undefined;

function transitionConnection(
  next: ConnectionPhase,
  notice: ConnectivityNotice,
): void {
  if (connection.phase === "unreachable") clearTimeout(connection.timer);
  connection = next;
  connectivityState.notice = notice;
}

/** 能動検出監視を開始する（多重起動はno-op） */
export function startConnectivityWatch(): void {
  if (watch.phase === "watching") return;
  watch = {
    phase: "watching",
    stop: startConnectivityTriggers(() => {
      void checkConnectivity();
    }),
  };
  document.addEventListener("visibilitychange", handleVisibilityChange);
}

/** 能動検出監視を停止する（多重停止はno-op） */
export function stopConnectivityWatch(): void {
  if (watch.phase === "stopped") return;
  if (watch.phase === "watching") watch.stop();
  watch = { phase: "stopped" };
  generation++;
  inflight = undefined;
  silentPassFailedAt = undefined;
  document.removeEventListener("visibilitychange", handleVisibilityChange);
  recoverConnectivity();
}

function recoverConnectivity(): void {
  transitionConnection({ phase: "healthy" }, "none");
  stopAuthWatch(true);
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
  if (connection.phase === "unreachable") {
    if (connectivityState.notice === "reload-required") {
      transitionConnection({ phase: "intercepted" }, "reload-required");
    } else {
      transitionConnection({ phase: "healthy" }, "none");
    }
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
  if (watch.phase === "stopped") return classifyHealth(fetchFn);
  const current = generation;
  inflight ??= runCheck(fetchFn, current).finally(() => {
    if (current === generation) inflight = undefined;
  });
  return inflight;
}

async function runCheck(
  fetchFn: typeof fetch,
  current: number,
): Promise<Health> {
  const health = await classifyHealth(fetchFn);
  if (current !== generation) return health;
  debugLog("connectivity", "check", { health });
  if (health === "healthy") {
    recoverConnectivity();
  } else if (health === "unreachable") {
    handleUnreachable(fetchFn);
  } else {
    transitionConnection(
      { phase: "intercepted" },
      connectivityState.notice === "reload-required"
        ? "reload-required"
        : "none",
    );
    const afterPass = await trySilentPass(fetchFn, current);
    if (current !== generation) return health;
    if (afterPass === "healthy") {
      recoverConnectivity();
      window.dispatchEvent(new Event(CONNECTIVITY_RECOVERED_EVENT));
    } else if (afterPass === "unreachable") {
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
async function trySilentPass(
  fetchFn: typeof fetch,
  current: number,
): Promise<Health> {
  if (
    silentPassFailedAt !== undefined &&
    Date.now() - silentPassFailedAt < SILENT_PASS_RETRY_INTERVAL_MS
  ) {
    return "intercepted";
  }
  // キャッシュを避けるため毎回異なるURLで読み込む
  await loadHiddenFrame(`/healthcheck?silent-pass=${Date.now()}`);
  if (current !== generation) return "intercepted";
  const health = await classifyHealth(fetchFn);
  if (current !== generation) return health;
  debugLog("connectivity", "silent-pass", { health });
  silentPassFailedAt = health === "intercepted" ? Date.now() : undefined;
  return health;
}

/** 到達不能の継続時間で案内を出すか決め、回復を早く捉えるための再判定を予約する */
function handleUnreachable(fetchFn: typeof fetch): void {
  if (document.visibilityState === "hidden") return;
  const now = Date.now();
  const since = connection.phase === "unreachable" ? connection.since : now;
  const notice =
    now - since >= UNREACHABLE_NOTICE_DELAY_MS
      ? "unreachable"
      : connectivityState.notice === "reload-required"
        ? "reload-required"
        : "none";
  const timer = setTimeout(() => {
    void checkConnectivity(fetchFn);
  }, UNREACHABLE_RECHECK_INTERVAL_MS);
  transitionConnection({ phase: "unreachable", since, timer }, notice);
}

/**
 * 認証画面を別ウィンドウで開き、認証の完了（健全の判定）を短い間隔で待つ。
 *
 * ポップアップが阻止されて開けなかった場合は再判定を始めず、バナーの再読み込みボタンで回復できる状態を保つ。
 * `fetchFn` はテスト用の差し替え口で、本番では既定の `fetch` を使う。
 */
export function openAuthWindow(fetchFn: typeof fetch = fetch): void {
  if (watch.phase === "stopped") return;
  if (authWatch.phase === "monitoring" && !authWatch.window.closed) {
    authWatch.window.focus();
    return;
  }
  stopAuthWatch(false);
  const authWindow = window.open("/healthcheck", "glatasks-auth");
  debugLog("connectivity", "auth-window", { opened: authWindow !== null });
  if (!authWindow) return;
  authWatch = { phase: "monitoring", window: authWindow };
  scheduleAuthRecheck(authWatch, fetchFn);
}

function scheduleAuthRecheck(session: AuthWatch, fetchFn: typeof fetch): void {
  session.timer = setTimeout(() => {
    session.timer = undefined;
    if (session.window.closed) {
      stopAuthWatch(false);
      return;
    }
    void checkConnectivity(fetchFn).then(() => {
      if (authWatch === session) {
        if (session.window.closed) stopAuthWatch(false);
        else scheduleAuthRecheck(session, fetchFn);
      }
    });
  }, UNREACHABLE_RECHECK_INTERVAL_MS);
}

function stopAuthWatch(close: boolean): void {
  const session = authWatch;
  authWatch = { phase: "closed" };
  if (session.phase === "closed") return;
  clearTimeout(session.timer);
  if (close && !session.window.closed) session.window.close();
}

/** 応答の横取りを検知した時に呼び出され、退避できない場合はバナー表示、それ以外は即リロードする */
function triggerReload(): void {
  if (!saveRecoveryDrafts()) {
    debugLog("connectivity", "recover", { mode: "banner" });
    connectivityState.notice = "reload-required";
  } else {
    debugLog("connectivity", "recover", { mode: "reload" });
    // eslint-disable-next-line no-restricted-syntax -- 応答の横取りのときだけ再読み込みし、到達不能では呼ばない。再読み込み先でキャプティブポータルの認証画面へ誘導する
    location.reload();
  }
}
