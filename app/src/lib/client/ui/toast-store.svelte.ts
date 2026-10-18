/**
 * @fileoverview エラートースト通知のリアクティブストア
 *
 * モジュールレベルの $state でトースト状態を管理し、
 * コンポーネント外（QueryClient の onError 等）からもトリガーできる。
 */

type Toast = {
  id: number;
  message: string;
};

let nextId = 0;
let toasts = $state<Toast[]>([]);

/** 現在表示中のトースト一覧 */
export function getToasts(): Toast[] {
  return toasts;
}

/** 自動消去までの最短の表示時間（ミリ秒） */
const MIN_TOAST_MS = 5000;

/** 1文字あたりの表示時間（ミリ秒）。次の操作を含む長い文面を消去までに読み終えられるようにする */
const TOAST_MS_PER_CHAR = 150;

/** 文面の長さに応じた自動消去までの表示時間を返す（最短5秒） */
export function getToastDurationMs(message: string): number {
  return Math.max(MIN_TOAST_MS, message.length * TOAST_MS_PER_CHAR);
}

/** エラートーストを表示する（文面の長さに応じた時間の後に自動消去） */
export function showErrorToast(message: string): void {
  const id = nextId++;
  toasts = [...toasts, { id, message }];
  setTimeout(() => dismissToast(id), getToastDurationMs(message));
}

/** 指定トーストを消去する */
export function dismissToast(id: number): void {
  toasts = toasts.filter((t) => t.id !== id);
}
