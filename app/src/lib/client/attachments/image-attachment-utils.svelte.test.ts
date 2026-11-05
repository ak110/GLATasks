import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createThumbnailManager } from "./image-attachment-utils.svelte.ts";

const downloadQuery = vi.hoisted(() => vi.fn());
vi.mock("#lib/client/trpc.ts", () => ({
  trpc: { attachments: { download: { query: downloadQuery } } },
}));

describe("Lightboxの取得と表示の寿命", () => {
  beforeEach(() => {
    downloadQuery.mockReset();
    vi.stubGlobal(
      "URL",
      class extends URL {
        static createObjectURL = vi.fn(() => "blob:image");
        static revokeObjectURL = vi.fn();
      },
    );
  });
  afterEach(() => vi.unstubAllGlobals());

  it.each(["close", "delete", "dispose"] as const)(
    "取得中の%sで表示要求を失効させる",
    async (operation) => {
      const download = Promise.withResolvers<{
        data: string;
        mimeType: string;
      }>();
      downloadQuery.mockReturnValue(download.promise);
      const manager = createThumbnailManager();
      const pending = manager.open(1);
      if (operation === "close") manager.close();
      if (operation === "delete") manager.sync([]);
      if (operation === "dispose") manager.dispose();
      download.resolve({ data: "AQ==", mimeType: "image/png" });
      await pending;
      expect(manager.lightboxImageUrl).toBeNull();
      manager.dispose();
    },
  );

  it("後から開いた画像を遅い取得結果で置き換えない", async () => {
    const first = Promise.withResolvers<{ data: string; mimeType: string }>();
    downloadQuery
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue({ data: "Ag==", mimeType: "image/png" });
    let counter = 0;
    vi.mocked(URL.createObjectURL).mockImplementation(
      () => `blob:${++counter}`,
    );
    const manager = createThumbnailManager();
    const pending = manager.open(1);
    await manager.open(2);
    const current = manager.lightboxImageUrl;
    first.resolve({ data: "AQ==", mimeType: "image/png" });
    await pending;
    expect(manager.lightboxImageUrl).toBe(current);
    manager.sync([1]);
    expect(manager.lightboxImageUrl).toBeNull();
    manager.dispose();
  });
});
