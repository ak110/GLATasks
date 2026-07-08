/**
 * @fileoverview 画像添付のBlob URL取得とキャッシュ管理
 *
 * TaskItem・TaskEditDialogの双方でサムネイル表示に使用する。
 * Blob URLの寿命管理（作成・キャッシュ・破棄）を一箇所へ集約する。
 */

import { trpc } from "$lib/trpc";
import { base64ToBytes } from "$lib/base64";

export interface BlobUrlCache {
  ensure(attachmentId: number): Promise<string>;
  syncWith(activeIds: Iterable<number>): void;
  clear(): void;
}

/**
 * 添付IDをキーとするBlob URLのキャッシュを生成する。
 *
 * - `ensure`: 未取得の場合はサーバーから画像を取得しBlob URLを生成しキャッシュする
 * - `syncWith`: 現在アクティブな添付ID集合と比較し、集合から外れたキャッシュエントリーをrevoke＋削除する
 * - `clear`: 全キャッシュを破棄する（コンポーネントアンマウント時のクリーンアップで呼ぶ）
 */
export function createBlobUrlCache(): BlobUrlCache {
  const cache = new Map<number, string>();
  let activeIdsSnapshot: Set<number> | null = null;
  let destroyed = false;
  return {
    async ensure(attachmentId: number): Promise<string> {
      if (destroyed) {
        throw new Error("キャッシュはすでに破棄されています");
      }
      const cached = cache.get(attachmentId);
      if (cached) return cached;
      const result = await trpc.attachments.download.query({ attachmentId });
      const bytes = base64ToBytes(result.data);
      const blob = new Blob([bytes], { type: result.mimeType });
      const url = URL.createObjectURL(blob);
      // race対策: ダウンロード中にコンポーネント破棄または対象添付削除が発生した場合はrevokeし、キャッシュ登録しない
      if (
        destroyed ||
        (activeIdsSnapshot && !activeIdsSnapshot.has(attachmentId))
      ) {
        URL.revokeObjectURL(url);
        throw new Error(`添付ID ${attachmentId} は取得中に削除されました`);
      }
      cache.set(attachmentId, url);
      return url;
    },
    syncWith(activeIds: Iterable<number>): void {
      const active = new Set(activeIds);
      activeIdsSnapshot = active;
      for (const [id, url] of cache) {
        if (!active.has(id)) {
          URL.revokeObjectURL(url);
          cache.delete(id);
        }
      }
    },
    clear(): void {
      destroyed = true;
      for (const url of cache.values()) {
        URL.revokeObjectURL(url);
      }
      cache.clear();
    },
  };
}
