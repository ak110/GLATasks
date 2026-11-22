import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { HealthState } from "#lib/client/sse/sse-client.ts";

const FALLBACK_POLL_INTERVAL_MS = 30_000;

const hoisted = vi.hoisted(() => ({
  healthListeners: [] as Array<(state: HealthState) => void>,
  mockHealth: "initial" as HealthState,
  checkConnectivityMock: vi.fn(),
}));

vi.mock("#lib/client/sse/sse-client.ts", () => ({
  subscribe: vi.fn(() => vi.fn()),
  onHealthChange: vi.fn((cb: (state: HealthState) => void) => {
    hoisted.healthListeners.push(cb);
    return () => {
      const i = hoisted.healthListeners.indexOf(cb);
      if (i >= 0) hoisted.healthListeners.splice(i, 1);
    };
  }),
  getHealth: vi.fn(() => hoisted.mockHealth),
}));

vi.mock("#lib/client/sse/connection-recovery.svelte.ts", () => ({
  checkConnectivity: () => hoisted.checkConnectivityMock(),
}));

function setHealth(state: HealthState): void {
  hoisted.mockHealth = state;
  for (const cb of hoisted.healthListeners) cb(state);
}

describe("setupSseSubscriptions", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    hoisted.healthListeners = [];
    hoisted.mockHealth = "initial";
    hoisted.checkConnectivityMock.mockReset();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([
    { label: "0秒（即時実行直後）", elapsedMs: 0, expectedCalls: 1 },
    { label: "29秒（1回目周期直前）", elapsedMs: 29_000, expectedCalls: 1 },
    { label: "30秒（1回目周期）", elapsedMs: 30_000, expectedCalls: 2 },
    { label: "31秒（1回目周期直後）", elapsedMs: 31_000, expectedCalls: 2 },
    { label: "60秒（2回目周期）", elapsedMs: 60_000, expectedCalls: 3 },
  ])(
    "unhealthy 遷移後 $label でフォールバック呼び出し回数=$expectedCalls",
    async ({ elapsedMs, expectedCalls }) => {
      const { setupSseSubscriptions } =
        await import("#lib/client/sse/sse-subscribe.ts");
      const fallback = vi.fn().mockResolvedValue(undefined);
      const cleanup = setupSseSubscriptions({
        "lists:updated": { handler: vi.fn(), fallback },
      });

      setHealth("unhealthy");
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(elapsedMs);
      expect(fallback).toHaveBeenCalledTimes(expectedCalls);

      cleanup();
    },
  );

  it('"healthy" 遷移でポーリングが停止する', async () => {
    const { setupSseSubscriptions } =
      await import("#lib/client/sse/sse-subscribe.ts");
    const fallback = vi.fn().mockResolvedValue(undefined);
    const cleanup = setupSseSubscriptions({
      "lists:updated": { handler: vi.fn(), fallback },
    });

    setHealth("unhealthy");
    await vi.advanceTimersByTimeAsync(0);
    expect(fallback).toHaveBeenCalledTimes(1);

    setHealth("healthy");
    await vi.advanceTimersByTimeAsync(FALLBACK_POLL_INTERVAL_MS);
    expect(fallback).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it("cleanup 呼び出しでポーリングタイマーが解除される", async () => {
    const { setupSseSubscriptions } =
      await import("#lib/client/sse/sse-subscribe.ts");
    const fallback = vi.fn().mockResolvedValue(undefined);
    const cleanup = setupSseSubscriptions({
      "lists:updated": { handler: vi.fn(), fallback },
    });

    setHealth("unhealthy");
    await vi.advanceTimersByTimeAsync(0);
    expect(fallback).toHaveBeenCalledTimes(1);

    cleanup();
    await vi.advanceTimersByTimeAsync(FALLBACK_POLL_INTERVAL_MS);
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it("マウント時に既に unhealthy なら即時実行する", async () => {
    hoisted.mockHealth = "unhealthy";
    const { setupSseSubscriptions } =
      await import("#lib/client/sse/sse-subscribe.ts");
    const fallback = vi.fn().mockResolvedValue(undefined);
    const cleanup = setupSseSubscriptions({
      "lists:updated": { handler: vi.fn(), fallback },
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(hoisted.checkConnectivityMock).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it("unhealthy 遷移時に能動チェックへ通知する", async () => {
    const { setupSseSubscriptions } =
      await import("#lib/client/sse/sse-subscribe.ts");
    const fallback = vi.fn().mockResolvedValue(undefined);
    const cleanup = setupSseSubscriptions({
      "lists:updated": { handler: vi.fn(), fallback },
    });

    setHealth("unhealthy");
    await vi.advanceTimersByTimeAsync(0);
    expect(hoisted.checkConnectivityMock).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it("フォールバックエラーでもリロード誘導せず能動チェックに委ねる", async () => {
    const { setupSseSubscriptions } =
      await import("#lib/client/sse/sse-subscribe.ts");
    const fallback = vi.fn().mockRejectedValue(new TypeError("network error"));
    const cleanup = setupSseSubscriptions({
      "lists:updated": { handler: vi.fn(), fallback },
    });

    setHealth("unhealthy");
    await vi.advanceTimersByTimeAsync(0);
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(hoisted.checkConnectivityMock).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it("複数イベントのフォールバックが登録順に呼ばれる", async () => {
    const { setupSseSubscriptions } =
      await import("#lib/client/sse/sse-subscribe.ts");
    const order: string[] = [];
    const fb1 = vi.fn().mockImplementation(() => {
      order.push("fb1");
    });
    const fb2 = vi.fn().mockImplementation(() => {
      order.push("fb2");
    });
    const cleanup = setupSseSubscriptions({
      "lists:updated": { handler: vi.fn(), fallback: fb1 },
      "tasks:updated": { handler: vi.fn(), fallback: fb2 },
    });

    setHealth("unhealthy");
    await vi.advanceTimersByTimeAsync(0);
    expect(order).toEqual(["fb1", "fb2"]);

    cleanup();
  });

  it("フォールバックエラー後もポーリングは継続する", async () => {
    const { setupSseSubscriptions } =
      await import("#lib/client/sse/sse-subscribe.ts");
    const fallback = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network error"))
      .mockResolvedValue(undefined);
    const cleanup = setupSseSubscriptions({
      "lists:updated": { handler: vi.fn(), fallback },
    });

    setHealth("unhealthy");
    await vi.advanceTimersByTimeAsync(0);
    expect(fallback).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(FALLBACK_POLL_INTERVAL_MS);
    expect(fallback).toHaveBeenCalledTimes(2);

    cleanup();
  });

  it('"unhealthy" → "initial" 再遷移でポーリングを停止しない', async () => {
    const { setupSseSubscriptions } =
      await import("#lib/client/sse/sse-subscribe.ts");
    const fallback = vi.fn().mockResolvedValue(undefined);
    const cleanup = setupSseSubscriptions({
      "lists:updated": { handler: vi.fn(), fallback },
    });

    setHealth("unhealthy");
    await vi.advanceTimersByTimeAsync(0);
    expect(fallback).toHaveBeenCalledTimes(1);

    setHealth("initial");
    await vi.advanceTimersByTimeAsync(FALLBACK_POLL_INTERVAL_MS);
    expect(fallback).toHaveBeenCalledTimes(2);

    cleanup();
  });

  it("フォールバック未指定でも unhealthy 遷移で能動チェックへ通知する", async () => {
    const { setupSseSubscriptions } =
      await import("#lib/client/sse/sse-subscribe.ts");
    const cleanup = setupSseSubscriptions({
      "lists:updated": { handler: vi.fn() },
    });

    setHealth("unhealthy");
    await vi.advanceTimersByTimeAsync(0);
    expect(hoisted.checkConnectivityMock).toHaveBeenCalledTimes(1);

    cleanup();
  });
});
