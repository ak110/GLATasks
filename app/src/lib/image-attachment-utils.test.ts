/**
 * @fileoverview image-attachment-utilsの単体テスト
 *
 * `trpc.attachments.download.query`をモックしてBlob URLキャッシュの分岐を検証する。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { downloadQueryMock } = vi.hoisted(() => ({
  downloadQueryMock: vi.fn(),
}));

vi.mock("$lib/trpc", () => ({
  trpc: {
    attachments: {
      download: { query: downloadQueryMock },
    },
  },
}));

import { createBlobUrlCache } from "./image-attachment-utils";

/** URL.createObjectURL / revokeObjectURLをスパイに差し替える */
function installUrlSpies() {
  let counter = 0;
  const revoked: string[] = [];
  const createSpy = vi
    .spyOn(URL, "createObjectURL")
    .mockImplementation(() => `blob:mock-${++counter}`);
  const revokeSpy = vi
    .spyOn(URL, "revokeObjectURL")
    .mockImplementation((url: string) => {
      revoked.push(url);
    });
  return { createSpy, revokeSpy, revoked };
}

/** `attachments.download.query`の既定レスポンス */
function makeDownloadResponse(id: number) {
  return {
    filename: `file-${id}.png`,
    mimeType: "image/png",
    // 1バイト分のbase64（"AQ==" → 0x01）
    data: "AQ==",
  };
}

describe("createBlobUrlCache", () => {
  beforeEach(() => {
    downloadQueryMock.mockReset();
    vi.restoreAllMocks();
  });

  it("初回ensureはサーバーへ問い合わせBlob URLを返す", async () => {
    const { createSpy } = installUrlSpies();
    downloadQueryMock.mockResolvedValue(makeDownloadResponse(1));
    const cache = createBlobUrlCache();
    const url = await cache.ensure(1);
    expect(url).toBe("blob:mock-1");
    expect(downloadQueryMock).toHaveBeenCalledTimes(1);
    expect(createSpy).toHaveBeenCalledTimes(1);
  });

  it("2回目以降のensureはキャッシュヒットしサーバー問い合わせをしない", async () => {
    installUrlSpies();
    downloadQueryMock.mockResolvedValue(makeDownloadResponse(1));
    const cache = createBlobUrlCache();
    const url1 = await cache.ensure(1);
    const url2 = await cache.ensure(1);
    expect(url1).toBe(url2);
    expect(downloadQueryMock).toHaveBeenCalledTimes(1);
  });

  it("clear後のensureは例外を送出する", async () => {
    installUrlSpies();
    downloadQueryMock.mockResolvedValue(makeDownloadResponse(1));
    const cache = createBlobUrlCache();
    cache.clear();
    await expect(cache.ensure(1)).rejects.toThrow(/破棄されています/);
  });

  it("syncWithでactive集合から外れたIDのBlob URLをrevokeし、以後は再取得になる", async () => {
    const { revoked } = installUrlSpies();
    downloadQueryMock.mockResolvedValue(makeDownloadResponse(1));
    const cache = createBlobUrlCache();
    cache.syncWith([1]);
    const first = await cache.ensure(1);
    cache.syncWith([]);
    expect(revoked).toContain(first);
    // 再度アクティブ化した後のensureで新しいURLが返る
    cache.syncWith([1]);
    downloadQueryMock.mockResolvedValue(makeDownloadResponse(1));
    const second = await cache.ensure(1);
    expect(second).not.toBe(first);
    expect(downloadQueryMock).toHaveBeenCalledTimes(2);
  });

  it("clearはキャッシュ済みの全Blob URLをrevokeする", async () => {
    const { revoked } = installUrlSpies();
    downloadQueryMock.mockImplementation(async ({ attachmentId }) =>
      makeDownloadResponse(attachmentId),
    );
    const cache = createBlobUrlCache();
    const url1 = await cache.ensure(1);
    const url2 = await cache.ensure(2);
    cache.clear();
    expect(revoked).toContain(url1);
    expect(revoked).toContain(url2);
  });

  it("ensure中に対象がsyncWithで非アクティブになった場合はrevoke＋キャッシュ登録しない", async () => {
    const { revoked } = installUrlSpies();
    let resolveDownload:
      | ((v: ReturnType<typeof makeDownloadResponse>) => void)
      | undefined;
    downloadQueryMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveDownload = resolve;
        }),
    );
    const cache = createBlobUrlCache();
    const pending = cache.ensure(1);
    // ダウンロード完了前にID:1を非アクティブ化
    cache.syncWith([]);
    resolveDownload!(makeDownloadResponse(1));
    await expect(pending).rejects.toThrow(/取得中に削除されました/);
    // 生成されたBlob URLがrevokeされている
    expect(revoked.length).toBeGreaterThan(0);
  });
});
