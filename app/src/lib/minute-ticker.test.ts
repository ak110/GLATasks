/**
 * @fileoverview 分の切り替わりごとに処理を呼ぶタイマーのテスト
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { startMinuteTicker } from "./minute-ticker";

describe("startMinuteTicker", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-02T03:04:50.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("分の切り替わりごとに呼び、停止後は呼ばない", () => {
    const callback = vi.fn();
    const stop = startMinuteTicker(callback);

    vi.advanceTimersByTime(9_999);
    expect(callback).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(60_000);
    expect(callback).toHaveBeenCalledTimes(2);

    stop();
    vi.advanceTimersByTime(120_000);
    expect(callback).toHaveBeenCalledTimes(2);
  });
});
