/**
 * @fileoverview 新しい版の検知後の自動再読み込みのユニットテスト
 *
 * 作業中・保存中・通信断では再読み込みを見送って試し直し、条件が揃った時点で1回だけ再読み込みすることを、
 * 見送り要因ごとの代表値で検証する。時間経過はfake timersで制御する。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  startUpdateAutoReload,
  UPDATE_RELOAD_RETRY_INTERVAL_MS,
  type UpdateReloadOptions,
} from "#lib/client/ui/update-reload.ts";

function makeOptions(overrides: Partial<UpdateReloadOptions> = {}) {
  return {
    isBusy: vi.fn(() => false),
    hasPendingWrites: vi.fn(() => false),
    isServerHealthy: vi.fn(async () => true),
    reload: vi.fn(),
    ...overrides,
  };
}

describe("startUpdateAutoReload", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  it("作業中でなく保存中でもなく接続が健全なら、直ちに1回だけ再読み込みする", async () => {
    const options = makeOptions();
    startUpdateAutoReload(options);
    await vi.advanceTimersByTimeAsync(0);
    expect(options.reload).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(UPDATE_RELOAD_RETRY_INTERVAL_MS * 3);
    expect(options.reload).toHaveBeenCalledTimes(1);
  });

  it.each([
    { label: "作業中", key: "isBusy" as const },
    { label: "保存中", key: "hasPendingWrites" as const },
  ])(
    "$label の間は再読み込みを見送り、終わった後の試し直しで再読み込みする",
    async ({ key }) => {
      let blocked = true;
      const options = makeOptions({ [key]: vi.fn(() => blocked) });
      startUpdateAutoReload(options);
      await vi.advanceTimersByTimeAsync(UPDATE_RELOAD_RETRY_INTERVAL_MS * 2);
      expect(options.reload).not.toHaveBeenCalled();

      blocked = false;
      await vi.advanceTimersByTimeAsync(UPDATE_RELOAD_RETRY_INTERVAL_MS);
      expect(options.reload).toHaveBeenCalledTimes(1);
    },
  );

  it("接続が健全でない間は再読み込みを見送る（通信断でオフライン画面へ移らないため）", async () => {
    let healthy = false;
    const options = makeOptions({
      isServerHealthy: vi.fn(async () => healthy),
    });
    startUpdateAutoReload(options);
    await vi.advanceTimersByTimeAsync(UPDATE_RELOAD_RETRY_INTERVAL_MS * 2);
    expect(options.reload).not.toHaveBeenCalled();

    healthy = true;
    await vi.advanceTimersByTimeAsync(UPDATE_RELOAD_RETRY_INTERVAL_MS);
    expect(options.reload).toHaveBeenCalledTimes(1);
  });

  it("健全確認を待つ間に作業が始まった場合は再読み込みを見送る", async () => {
    let busy = false;
    const options = makeOptions({
      isBusy: vi.fn(() => busy),
      isServerHealthy: vi.fn(async () => {
        busy = true;
        return true;
      }),
    });
    startUpdateAutoReload(options);
    await vi.advanceTimersByTimeAsync(0);
    expect(options.reload).not.toHaveBeenCalled();
  });

  it("停止後は試し直さない", async () => {
    const options = makeOptions({ isBusy: vi.fn(() => true) });
    const stop = startUpdateAutoReload(options);
    await vi.advanceTimersByTimeAsync(0);
    stop();
    vi.mocked(options.isBusy).mockReturnValue(false);
    await vi.advanceTimersByTimeAsync(UPDATE_RELOAD_RETRY_INTERVAL_MS * 3);
    expect(options.reload).not.toHaveBeenCalled();
  });
});
