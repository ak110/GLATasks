/**
 * @fileoverview 接続・同期経路デバッグログヘルパーのユニットテスト
 *
 * カテゴリと事象名を含む整形ラベルが `console.debug` へ渡ることを、
 * 付随データ有無の2ケースで検証する。
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import { debugLog } from "./debug-log";

describe("debugLog", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("付随データ無しではラベルのみを console.debug へ渡す", () => {
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    debugLog("sse", "connected");
    expect(spy).toHaveBeenCalledExactlyOnceWith("[glatasks:sse] connected");
  });

  it("付随データ有りではラベルと付随データを console.debug へ渡す", () => {
    const spy = vi.spyOn(console, "debug").mockImplementation(() => {});
    debugLog("sync", "tasks", { fromOwnTab: false });
    expect(spy).toHaveBeenCalledExactlyOnceWith("[glatasks:sync] tasks", {
      fromOwnTab: false,
    });
  });
});
