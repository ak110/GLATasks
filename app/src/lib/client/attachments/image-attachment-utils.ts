/**
 * @fileoverview 画像添付のBlob URL取得とキャッシュ管理
 *
 * TaskItem・TaskEditDialogの双方でサムネイル表示に使用する。
 * Blob URLの寿命管理（作成・キャッシュ・破棄）を一箇所へ集約する。
 */

import { trpc } from "#lib/client/trpc.ts";
import { base64ToBytes } from "#lib/base64.ts";

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
  type CacheEntry =
    | { status: "loading"; promise: Promise<string> }
    | { status: "ready"; url: string };
  const cache = new Map<number, CacheEntry>();
  let activeIdsSnapshot: Set<number> | undefined;
  let destroyed = false;
  return {
    async ensure(attachmentId: number): Promise<string> {
      if (destroyed) {
        throw new Error("キャッシュはすでに破棄されています");
      }
      const cached = cache.get(attachmentId);
      if (cached?.status === "ready") return cached.url;
      if (cached?.status === "loading") return cached.promise;
      const entry: CacheEntry = {
        status: "loading",
        promise: trpc.attachments.download
          .query({ attachmentId })
          .then((result) => {
            const bytes = base64ToBytes(result.data);
            const blob = new Blob([bytes], { type: result.mimeType });
            const url = URL.createObjectURL(blob);
            // 同じIDが再追加されても、除外前の取得が新エントリーを上書きしない。
            if (
              destroyed ||
              cache.get(attachmentId) !== entry ||
              (activeIdsSnapshot && !activeIdsSnapshot.has(attachmentId))
            ) {
              URL.revokeObjectURL(url);
              throw new Error(
                `添付ID ${attachmentId} は取得中に削除されました。タスクを開き直して最新の添付ファイルを確認してください`,
              );
            }
            cache.set(attachmentId, { status: "ready", url });
            return url;
          })
          .catch((error: unknown) => {
            if (cache.get(attachmentId) === entry) cache.delete(attachmentId);
            throw error;
          }),
      };
      cache.set(attachmentId, entry);
      return entry.promise;
    },
    syncWith(activeIds: Iterable<number>): void {
      const active = new Set(activeIds);
      activeIdsSnapshot = active;
      for (const [id, entry] of cache) {
        if (!active.has(id)) {
          if (entry.status === "ready") URL.revokeObjectURL(entry.url);
          cache.delete(id);
        }
      }
    },
    clear(): void {
      destroyed = true;
      for (const entry of cache.values()) {
        if (entry.status === "ready") URL.revokeObjectURL(entry.url);
      }
      cache.clear();
    },
  };
}
