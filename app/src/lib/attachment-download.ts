/**
 * @fileoverview 添付ファイルのダウンロード処理
 *
 * tRPCの`attachments.download`でbase64データを取得し、
 * Blob化してブラウザネイティブのダウンロード動作を発火する。
 */

import { base64ToBytes } from "$lib/base64";
import { trpc } from "$lib/trpc";

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
