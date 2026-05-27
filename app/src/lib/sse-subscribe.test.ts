/**
 * @fileoverview SSE購読＋ポーリングフォールバック機構のユニットテスト
 *
 * `setupSseSubscriptions` の発火タイミングを境界値（0秒・29秒・30秒・31秒・60秒）と
 * 状態遷移（`"unhealthy"` 即時実行 → 30秒間隔 → `"healthy"` で停止）で検証する。
 * フォールバックはデータ再取得に専念し、`"unhealthy"` 遷移時に能動チェックへ通知する。
 * sse-clientは `vi.hoisted` で定義したコントロール変数で差し替える。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { HealthState } from "./sse-client";

const FALLBACK_POLL_INTERVAL_MS = 30_000;

const hoisted = vi.hoisted(() => ({
  healthListeners: [] as Array<(state: HealthState) => void>,
  mockHealth: "initial" as HealthState,
  checkConnectivityMock: vi.fn(),
}));

vi.mock("./sse-client", () => ({
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

vi.mock("./connection-recovery.svelte", () => ({
  checkConnectivity: () => hoisted.checkConnectivityMock(),
}));

/** 健全性状態を変更し、登録済みリスナーへ通知する */
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

  // 同値分割: "unhealthy" 遷移後の経過時間（即時 / 1回目周期前 / 1回目周期 / 2回目周期）
  // 境界値: 0秒（即時実行直後）・29秒（直前）・30秒（境界）・31秒（直後）・60秒（2回目）
  it.each([
    { label: "0秒（即時実行直後）", elapsedMs: 0, expectedCalls: 1 },
    { label: "29秒（1回目周期直前）", elapsedMs: 29_000, expectedCalls: 1 },
    { label: "30秒（1回目周期）", elapsedMs: 30_000, expectedCalls: 2 },
    { label: "31秒（1回目周期直後）", elapsedMs: 31_000, expectedCalls: 2 },
    { label: "60秒（2回目周期）", elapsedMs: 60_000, expectedCalls: 3 },
  ])(
    "unhealthy 遷移後 $label でフォールバック呼び出し回数=$expectedCalls",
    async ({ elapsedMs, expectedCalls }) => {
      const { setupSseSubscriptions } = await import("./sse-subscribe");
      const fallback = vi.fn().mockResolvedValue(undefined);
      const cleanup = setupSseSubscriptions({
        "lists:updated": { handler: vi.fn(), fallback },
      });

      setHealth("unhealthy");
      // 即時実行（runFallbacks 内の await が解決するまで進める）
      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(elapsedMs);
      expect(fallback).toHaveBeenCalledTimes(expectedCalls);

      cleanup();
    },
  );

  it('"healthy" 遷移でポーリングが停止する', async () => {
    const { setupSseSubscriptions } = await import("./sse-subscribe");
    const fallback = vi.fn().mockResolvedValue(undefined);
    const cleanup = setupSseSubscriptions({
      "lists:updated": { handler: vi.fn(), fallback },
    });

    setHealth("unhealthy");
    await vi.advanceTimersByTimeAsync(0);
    expect(fallback).toHaveBeenCalledTimes(1);

    // healthy 復帰でポーリングが停止し、以降30秒進めても増えない
    setHealth("healthy");
    await vi.advanceTimersByTimeAsync(FALLBACK_POLL_INTERVAL_MS);
    expect(fallback).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it("cleanup 呼び出しでポーリングタイマーが解除される", async () => {
    const { setupSseSubscriptions } = await import("./sse-subscribe");
    const fallback = vi.fn().mockResolvedValue(undefined);
    const cleanup = setupSseSubscriptions({
      "lists:updated": { handler: vi.fn(), fallback },
    });

    setHealth("unhealthy");
    await vi.advanceTimersByTimeAsync(0);
    expect(fallback).toHaveBeenCalledTimes(1);

    cleanup();
    // cleanup 後は30秒進めても増えない
    await vi.advanceTimersByTimeAsync(FALLBACK_POLL_INTERVAL_MS);
    expect(fallback).toHaveBeenCalledTimes(1);
  });

  it("マウント時に既に unhealthy なら即時実行する", async () => {
    hoisted.mockHealth = "unhealthy";
    const { setupSseSubscriptions } = await import("./sse-subscribe");
    const fallback = vi.fn().mockResolvedValue(undefined);
    const cleanup = setupSseSubscriptions({
      "lists:updated": { handler: vi.fn(), fallback },
    });

    await vi.advanceTimersByTimeAsync(0);
    expect(fallback).toHaveBeenCalledTimes(1);
    // マウント時に既存 unhealthy でも能動チェックへ通知する
    expect(hoisted.checkConnectivityMock).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it("unhealthy 遷移時に能動チェックへ通知する", async () => {
    const { setupSseSubscriptions } = await import("./sse-subscribe");
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
    const { setupSseSubscriptions } = await import("./sse-subscribe");
    const fallback = vi.fn().mockRejectedValue(new TypeError("network error"));
    const cleanup = setupSseSubscriptions({
      "lists:updated": { handler: vi.fn(), fallback },
    });

    setHealth("unhealthy");
    await vi.advanceTimersByTimeAsync(0);
    // フォールバックのエラーは無視し、検出は能動チェックの通知1回に集約される
    expect(fallback).toHaveBeenCalledTimes(1);
    expect(hoisted.checkConnectivityMock).toHaveBeenCalledTimes(1);

    cleanup();
  });

  it("複数イベントのフォールバックが登録順に呼ばれる", async () => {
    const { setupSseSubscriptions } = await import("./sse-subscribe");
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
    // フォールバックのエラーを無視してもポーリングタイマー自体は停止しないため、
    // SSE復帰までは30秒間隔で再試行され続ける。
    const { setupSseSubscriptions } = await import("./sse-subscribe");
    const fallback = vi
      .fn()
      .mockRejectedValueOnce(new TypeError("network error"))
      .mockResolvedValue(undefined);
    const cleanup = setupSseSubscriptions({
      "lists:updated": { handler: vi.fn(), fallback },
    });

    setHealth("unhealthy");
    // 1回目（即時実行）はエラーだが無視される
    await vi.advanceTimersByTimeAsync(0);
    expect(fallback).toHaveBeenCalledTimes(1);

    // 30秒経過で2回目のポーリングが走り、今度は成功する
    await vi.advanceTimersByTimeAsync(FALLBACK_POLL_INTERVAL_MS);
    expect(fallback).toHaveBeenCalledTimes(2);

    cleanup();
  });

  it('"unhealthy" → "initial" 再遷移でポーリングを停止しない', async () => {
    // SSE再接続時に "initial" へ戻るが、"healthy" 受信まではSSE経路の回復が
    // 確証されないため、起動済みのポーリングは継続する。
    const { setupSseSubscriptions } = await import("./sse-subscribe");
    const fallback = vi.fn().mockResolvedValue(undefined);
    const cleanup = setupSseSubscriptions({
      "lists:updated": { handler: vi.fn(), fallback },
    });

    setHealth("unhealthy");
    await vi.advanceTimersByTimeAsync(0);
    expect(fallback).toHaveBeenCalledTimes(1);

    // "initial" 再遷移はポーリングへ影響しない
    setHealth("initial");
    await vi.advanceTimersByTimeAsync(FALLBACK_POLL_INTERVAL_MS);
    expect(fallback).toHaveBeenCalledTimes(2);

    cleanup();
  });

  it("フォールバック未指定でも unhealthy 遷移で能動チェックへ通知する", async () => {
    const { setupSseSubscriptions } = await import("./sse-subscribe");
    const cleanup = setupSseSubscriptions({
      "lists:updated": { handler: vi.fn() },
    });

    setHealth("unhealthy");
    await vi.advanceTimersByTimeAsync(0);
    // フォールバックは空ループで何も再取得しないが、検出は能動チェックへ委ねられる
    expect(hoisted.checkConnectivityMock).toHaveBeenCalledTimes(1);

    cleanup();
  });
});
