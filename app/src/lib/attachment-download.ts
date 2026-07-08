/**
 * @fileoverview 添付ファイルのダウンロード処理
 *
 * tRPCの`attachments.download`でbase64データを取得し、
 * Blob化してブラウザネイティブのダウンロード動作を発火する。
 */

import { trpc } from "$lib/trpc";

/**
 * base64文字列をUint8Arrayへデコードする。
 *
 * `String.fromCharCode(...arr)`によるスプレッド展開は引数長に上限があり、
 * 10 MiB相当の大きな配列では呼び出しスタック上限を超えるため、
 * `atob`後の1バイトずつのfor-loop書き込みで代替する。
 */
export function base64ToBytes(base64: string): Uint8Array<ArrayBuffer> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** 添付ファイルをダウンロードする */
export async function downloadAttachment(attachmentId: number): Promise<void> {
  const { filename, mimeType, data } = await trpc.attachments.download.query({
    attachmentId,
  });

  const bytes = base64ToBytes(data);
  const blob = new Blob([bytes], { type: mimeType });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
