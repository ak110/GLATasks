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

/** 添付ファイルのMIMEタイプが画像かどうかを判定する */
export function isImageAttachment(mimeType: string): boolean {
  return mimeType.startsWith("image/");
}

let clipboardSequence = 0;
let clipboardSequenceKey = "";

/**
 * ClipboardEventから画像ファイルを抽出する。
 * ペースト経由の画像は`File.name`が空になり得るため
 * `clipboard-<yyyymmdd-HHMMSS>-<seq>.<ext>`で自動命名する。
 * `seq`は同一秒内の連番でファイル名重複を防止する。
 */
export function extractImageFilesFromClipboard(event: ClipboardEvent): File[] {
  const items = event.clipboardData?.files;
  if (!items || items.length === 0) return [];
  const results: File[] = [];
  for (const file of Array.from(items)) {
    if (!isImageAttachment(file.type)) continue;
    if (file.name) {
      results.push(file);
      continue;
    }
    results.push(renameClipboardFile(file));
  }
  return results;
}

function renameClipboardFile(file: File): File {
  const ext = file.type.split("/")[1] ?? "bin";
  const now = new Date();
  const yyyymmdd =
    `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}` +
    `${String(now.getDate()).padStart(2, "0")}`;
  const hhmmss =
    `${String(now.getHours()).padStart(2, "0")}` +
    `${String(now.getMinutes()).padStart(2, "0")}` +
    `${String(now.getSeconds()).padStart(2, "0")}`;
  const key = `${yyyymmdd}-${hhmmss}`;
  if (clipboardSequenceKey !== key) {
    clipboardSequenceKey = key;
    clipboardSequence = 0;
  }
  clipboardSequence += 1;
  const seq = String(clipboardSequence).padStart(3, "0");
  const name = `clipboard-${key}-${seq}.${ext}`;
  return new File([file], name, { type: file.type });
}
