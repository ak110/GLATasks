/**
 * @fileoverview 添付ファイルのデータ変換・アップロード共通処理
 */

import { trpc } from "$lib/trpc";

/** ファイルドロップ中のハイライト表示に使うTailwindクラス（タスク追加フォーム・編集ダイアログ共通） */
export const FILE_DROP_HIGHLIGHT_CLASSES =
  "bg-blue-50 ring-2 ring-blue-400 ring-inset dark:bg-blue-900/30 dark:ring-blue-500";

/** ファイルをbase64（data URLのプレフィックスを除いた部分）として読み込む */
export function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.slice(result.indexOf(",") + 1));
    };
    reader.onerror = () =>
      reject(reader.error ?? new Error("ファイルの読み込みに失敗しました"));
    reader.readAsDataURL(file);
  });
}

/** ファイルを読み込みタスクへ添付登録する。失敗時は例外をそのまま呼び出し元へ再送出する */
export async function uploadAttachment(
  taskId: number,
  file: File,
): Promise<void> {
  const data = await readFileAsBase64(file);
  await trpc.attachments.create.mutate({
    taskId,
    filename: file.name,
    mimeType: file.type || "application/octet-stream",
    data,
  });
}
