/** エラートーストの自動消去までの表示時間が、文面の長さに応じて延びることを検証する。 */
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  getToastDurationMs,
  getToasts,
  showErrorToast,
} from "./toast-store.svelte";

afterEach(() => {
  vi.useRealTimers();
});

describe("getToastDurationMs", () => {
  // 境界値: 最短5秒を保つ長さ（33文字）と、それを超えて延びる長さ（34文字）
  it.each([
    { length: 0, expected: 5000 },
    { length: 33, expected: 5000 },
    { length: 34, expected: 5100 },
    { length: 100, expected: 15000 },
  ])("$length 文字は $expected ミリ秒", ({ length, expected }) => {
    expect(getToastDurationMs("あ".repeat(length))).toBe(expected);
  });
});

describe("showErrorToast", () => {
  it("長い文面は5秒を過ぎても表示を保ち、文面に応じた時間で消える", () => {
    vi.useFakeTimers();
    const message = "あ".repeat(100);
    showErrorToast(message);
    vi.advanceTimersByTime(5000);
    expect(getToasts().map((toast) => toast.message)).toContain(message);
    vi.advanceTimersByTime(10_000);
    expect(getToasts().map((toast) => toast.message)).not.toContain(message);
  });
});
