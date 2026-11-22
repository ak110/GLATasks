import {
  createBlobUrlCache,
  type BlobUrlCache,
} from "#lib/client/attachments/image-attachment-utils.ts";

export interface ThumbnailManager {
  readonly lightboxImageUrl: string | null;
  ensure(attachmentId: number): Promise<string>;
  open(attachmentId: number): Promise<void>;
  close(): void;
  sync(activeIds: Iterable<number>): void;
  dispose(): void;
}

export function createThumbnailManager(): ThumbnailManager {
  const cache: BlobUrlCache = createBlobUrlCache();
  type LightboxState =
    | { status: "closed" }
    | { status: "loading"; attachmentId: number; requestId: number }
    | {
        status: "showing";
        attachmentId: number;
        requestId: number;
        url: string;
      };
  let state = $state<LightboxState>({ status: "closed" });
  let generation = 0;
  return {
    get lightboxImageUrl(): string | null {
      return state.status === "showing" ? state.url : null;
    },
    ensure(attachmentId: number): Promise<string> {
      return cache.ensure(attachmentId);
    },
    async open(attachmentId: number): Promise<void> {
      const requestId = ++generation;
      state = { status: "loading", attachmentId, requestId };
      try {
        const url = await cache.ensure(attachmentId);
        if (generation === requestId) {
          state = { status: "showing", attachmentId, requestId, url };
        }
      } catch (error) {
        if (generation !== requestId) return;
        state = { status: "closed" };
        throw error;
      }
    },
    close(): void {
      ++generation;
      state = { status: "closed" };
    },
    sync(activeIds: Iterable<number>): void {
      const active = Array.from(activeIds);
      if (state.status !== "closed" && !active.includes(state.attachmentId)) {
        ++generation;
        state = { status: "closed" };
      }
      cache.syncWith(active);
    },
    dispose(): void {
      cache.clear();
      ++generation;
      state = { status: "closed" };
    },
  };
}
