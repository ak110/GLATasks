/**
 * @fileoverview 接続不全検知時の手動リロード／自動リロード経路
 *
 * SSE経由の同期が成立しない状況をポーリングfallback機構（`sse-subscribe.ts`）が
 * 検知した時点で呼び出される。入力中ユーザーの操作妨害を避けるため、
 * 検知時の挙動を入力中の有無で分岐する。
 *
 * - 非入力中: 即時に `location.reload()` を呼ぶ
 * - 入力中:   `connectivityState.pendingReload` を真にしてバナーから手動リロードを促す
 */

const state = $state({
  pendingReload: false,
});

/** バナー側から購読するリアクティブ状態 */
export const connectivityState = state;

/** 接続不全検知時に呼び出され、入力中ならバナー表示、非入力中なら即リロードする */
export function triggerReload(): void {
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
