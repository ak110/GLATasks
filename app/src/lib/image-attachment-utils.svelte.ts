/**
 * @fileoverview 画像添付のサムネイル＋ライトボックス状態管理
 *
 * TaskItem・TaskEditDialog双方で必要となる次の重複ロジックを集約する。
 *   - Blob URLキャッシュ（`createBlobUrlCache`）の生成
 *   - Lightbox表示中の画像URL（$state）
 *   - Lightboxオープン・クローズ処理
 *   - アクティブID集合との同期・破棄処理
 *
 * Svelte 5 runeを使用するため`.svelte.ts`拡張子で配置する。
 */

import {
  createBlobUrlCache,
  type BlobUrlCache,
} from "$lib/image-attachment-utils";

export interface ThumbnailManager {
  /** 現在Lightbox表示中の画像Blob URL（$state） */
  readonly lightboxImageUrl: string | null;
  /** サムネイル取得（テンプレートの`{#await}`用） */
  ensure(attachmentId: number): Promise<string>;
  /** Lightboxを開く（Blob URLを取得しlightboxImageUrlへ設定する） */
  open(attachmentId: number): Promise<void>;
  /** Lightboxを閉じる */
  close(): void;
  /** アクティブな添付ID集合と同期する（削除された添付のBlob URLをrevokeする） */
  sync(activeIds: Iterable<number>): void;
  /** コンポーネントアンマウント時に呼び出し、全キャッシュを破棄する */
  dispose(): void;
}

/**
 * サムネイル取得ロジックとLightbox状態を1つのオブジェクトへまとめる。
 * コンポーネントごとに呼び出して個別のインスタンスを保持する。
 */
export function createThumbnailManager(): ThumbnailManager {
  const cache: BlobUrlCache = createBlobUrlCache();
  let lightboxImageUrl = $state<string | null>(null);
  return {
    get lightboxImageUrl(): string | null {
      return lightboxImageUrl;
    },
    ensure(attachmentId: number): Promise<string> {
      return cache.ensure(attachmentId);
    },
    async open(attachmentId: number): Promise<void> {
      lightboxImageUrl = await cache.ensure(attachmentId);
    },
    close(): void {
      lightboxImageUrl = null;
    },
    sync(activeIds: Iterable<number>): void {
      cache.syncWith(activeIds);
    },
    dispose(): void {
      cache.clear();
      lightboxImageUrl = null;
    },
  };
}
