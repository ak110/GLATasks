/**
 * @fileoverview 新しい版の検知後の自動再読み込み
 *
 * 新しい版を検知したら、利用者が作業中でない時点を待って再読み込みし、
 * 「新しいバージョンが利用可能です」のバナーから再読み込みボタンを押す手間を省く。
 * 作業中（入力欄へのフォーカス、開いているダイアログ）と保存中は入力や保存を失うため見送り、
 * 一定間隔で条件を確かめ直す。通信断のまま再読み込みするとオフライン画面へ移るため、
 * 接続が健全と判定できた場合だけ再読み込みする。
 */

// 作業中・保存中・通信断で見送った後に条件を確かめ直す間隔
export const UPDATE_RELOAD_RETRY_INTERVAL_MS = 3_000;

export interface UpdateReloadOptions {
  /** 入力中やダイアログ表示中なら真 */
  isBusy: () => boolean;
  /** 保存処理（mutation）が進行中なら真 */
  hasPendingWrites: () => boolean;
  /** 接続が健全なら真。再読み込み先の画面を取得できるかの確認に使う */
  isServerHealthy: () => Promise<boolean>;
  reload: () => void;
  retryIntervalMs?: number;
}

/**
 * 条件が揃った時点で1回だけ再読み込みする試行を開始する。戻り値は試行を止める関数。
 *
 * 呼び出した時点で1回試し、見送った場合は`retryIntervalMs`ごとに試し直す。
 */
export function startUpdateAutoReload({
  isBusy,
  hasPendingWrites,
  isServerHealthy,
  reload,
  retryIntervalMs = UPDATE_RELOAD_RETRY_INTERVAL_MS,
}: UpdateReloadOptions): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const attempt = async (): Promise<void> => {
    timer = undefined;
    if (stopped) return;
    if (!isBusy() && !hasPendingWrites() && (await isServerHealthy())) {
      // 健全確認の待機中に作業が始まった場合は見送る
      if (!stopped && !isBusy() && !hasPendingWrites()) {
        stopped = true;
        reload();
        return;
      }
    }
    if (!stopped) timer = setTimeout(() => void attempt(), retryIntervalMs);
  };

  void attempt();
  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
  };
}
