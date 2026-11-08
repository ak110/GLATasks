/**
 * @fileoverview 利用者が作業中かの判定
 *
 * 自動の再読み込みは作業中の入力や開いているダイアログを失わせるため、
 * 接続回復と新しい版の検知の両方がこの判定で再読み込みを見送る。
 */

/** 入力欄・編集可能要素へのフォーカス、または開いているモーダルダイアログがあれば作業中とみなす */
export function isUserBusy(): boolean {
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
