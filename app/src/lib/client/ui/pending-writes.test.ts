/**
 * @fileoverview QueryClientを経由しない保存処理の進行状況のユニットテスト
 *
 * 保存処理の実行中だけ進行中と判定し、成功・失敗のどちらで終わっても進行中でなくなることを検証する。
 */

import { describe, expect, it } from "vitest";
import {
  hasPendingDirectWrites,
  trackPendingWrite,
} from "#lib/client/ui/pending-writes.ts";

describe("trackPendingWrite", () => {
  it("実行中だけ進行中と判定し、成功で終わると進行中でなくなる", async () => {
    let finish: (value: string) => void = () => {};
    const running = trackPendingWrite(
      () =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    expect(hasPendingDirectWrites()).toBe(true);

    finish("done");
    await expect(running).resolves.toBe("done");
    expect(hasPendingDirectWrites()).toBe(false);
  });

  it("失敗で終わっても進行中でなくなり、例外を呼び出し元へ渡す", async () => {
    const error = new Error("送信失敗");
    await expect(trackPendingWrite(() => Promise.reject(error))).rejects.toBe(
      error,
    );
    expect(hasPendingDirectWrites()).toBe(false);
  });
});
