/** エラートーストの自動消去までの表示時間が、文面の長さに応じて延びることを検証する。 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/svelte";
import { tick } from "svelte";
import Toast from "#lib/components/ui/Toast.svelte";
vi.mock("#lib/client/ui/notification-layer.ts", () => ({
  notificationLayer: () => undefined,
}));

import {
  getToastDurationMs,
  getToasts,
  showErrorToast,
  dismissToast,
} from "./toast-store.svelte";

afterEach(() => {
  for (const toast of getToasts()) dismissToast(toast.id);
  if (vi.isFakeTimers()) vi.clearAllTimers();
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
  it("発行idで自身の通知だけを消し、他の通知と自動消去を保つ", async () => {
    vi.useFakeTimers();
    render(Toast);
    const first = showErrorToast("Query Aの失敗");
    const second = showErrorToast("mutationの失敗");
    await tick();
    expect(screen.getAllByTestId("toast-error")).toHaveLength(2);
    expect(first).toBeTypeOf("number");
    expect(second).not.toBe(first);
    dismissToast(first);
    await tick();
    expect(screen.queryByText("Query Aの失敗")).not.toBeInTheDocument();
    expect(screen.getByText("mutationの失敗")).toBeVisible();
    vi.advanceTimersByTime(5000);
    await tick();
    expect(screen.queryByTestId("toast-error")).not.toBeInTheDocument();
  });
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
