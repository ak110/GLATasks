/**
 * @fileoverview 横取りした認証画面を非表示で読み込み、利用者の入力なしで通過するかを試す
 *
 * 社内ネットワークなどの認証画面には、端末の情報だけで自動的に通過する種類がある。
 * 同一オリジンの`/healthcheck`を非表示のiframeで読み込むと、通信を差し替える側がその中に認証画面を表示するため、
 * 自動で通過する認証なら画面を遷移せずに通信が戻る。
 * 埋め込みを拒否する認証画面や利用者の入力が必要な認証画面では通過しないため、呼び出し側は判定し直して
 * 従来の再読み込みや別ウィンドウでの認証へ進む。
 */

/** iframeの読み込み完了を待つ上限。応答の遅い認証画面でも回復誘導が止まらないようにする */
export const SILENT_PASS_LOAD_TIMEOUT_MS = 8_000;

/** 読み込み完了の後、認証画面のスクリプトやリダイレクトによる自動通過を待つ時間 */
export const SILENT_PASS_SETTLE_MS = 1_500;

/** 非表示のiframeで`url`を読み込み、読み込み完了から一定時間後か上限到達で取り除く */
export function loadHiddenFrame(url: string): Promise<void> {
  return new Promise((resolve) => {
    const frame = document.createElement("iframe");
    frame.hidden = true;
    frame.tabIndex = -1;
    frame.setAttribute("aria-hidden", "true");
    let settleTimer: ReturnType<typeof setTimeout> | undefined;
    const finish = () => {
      clearTimeout(loadTimer);
      clearTimeout(settleTimer);
      frame.remove();
      resolve();
    };
    const loadTimer = setTimeout(finish, SILENT_PASS_LOAD_TIMEOUT_MS);
    frame.addEventListener(
      "load",
      () => {
        settleTimer = setTimeout(finish, SILENT_PASS_SETTLE_MS);
      },
      { once: true },
    );
    // 読み込み自体の失敗（埋め込みの拒否で発火する環境や、iframeを読み込めない実行環境）では待たずに終える
    frame.addEventListener("error", finish, { once: true });
    frame.src = url;
    try {
      document.body.appendChild(frame);
    } catch {
      finish();
    }
  });
}
