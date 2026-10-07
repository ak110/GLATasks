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

/** エラートーストを表示する（5秒後に自動消去） */
export function showErrorToast(message: string): void {
  const id = nextId++;
  toasts = [...toasts, { id, message }];
  setTimeout(() => dismissToast(id), 5000);
}

/** 指定トーストを消去する */
export function dismissToast(id: number): void {
  toasts = toasts.filter((t) => t.id !== id);
}
