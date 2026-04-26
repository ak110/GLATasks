/**
 * @fileoverview ビープ音ユーティリティのユニットテスト
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  playBeep,
  playStartBeep,
  startLoopBeep,
  stopLoopBeep,
  stopAllLoopBeeps,
} from "./beep";

describe("playBeep", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("AudioContext が無い環境では警告ログを出力する", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(playBeep()).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledWith(
      "AudioContext が利用できないためビープ音を再生できません",
    );
  });

  it("AudioContext がある環境でビープ音を再生する", async () => {
    const stopFn = vi.fn();
    const startFn = vi.fn();
    const connectFn = vi.fn();
    const mockOsc = {
      frequency: { value: 0 },
      connect: connectFn,
      start: startFn,
      stop: stopFn,
    };
    const mockGain = {
      gain: { value: 0 },
      connect: connectFn,
    };
    const closeFn = vi.fn().mockResolvedValue(undefined);

    const MockAudioContext = vi.fn().mockImplementation(function () {
      return {
        currentTime: 0,
        destination: {},
        createOscillator: () => mockOsc,
        createGain: () => mockGain,
        close: closeFn,
      };
    });

    vi.stubGlobal("AudioContext", MockAudioContext);

    // playBeep(2) を起動し、fake timers で即座に進める
    const promise = playBeep(2);
    await vi.advanceTimersByTimeAsync(10000);
    await promise;

    expect(MockAudioContext).toHaveBeenCalledOnce();
    expect(startFn).toHaveBeenCalledTimes(2);
    expect(stopFn).toHaveBeenCalledTimes(2);
    expect(closeFn).toHaveBeenCalledOnce();

    vi.unstubAllGlobals();
  });
});

describe("startLoopBeep / stopLoopBeep", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    stopAllLoopBeeps();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("AudioContext が無い環境では警告ログを出力して何もしない", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    startLoopBeep(1);
    expect(warnSpy).toHaveBeenCalledOnce();
    // stop は no-op として安全に呼べる
    stopLoopBeep(1);
  });

  it("ループ再生中に stop すると AudioContext が close される", async () => {
    const closeFn = vi.fn().mockResolvedValue(undefined);
    const startFn = vi.fn();
    const stopFn = vi.fn();
    const MockAudioContext = vi.fn().mockImplementation(function () {
      return {
        currentTime: 0,
        destination: {},
        createOscillator: () => ({
          frequency: { value: 0 },
          connect: vi.fn(),
          start: startFn,
          stop: stopFn,
        }),
        createGain: () => ({
          gain: { value: 0 },
          connect: vi.fn(),
        }),
        close: closeFn,
      };
    });
    vi.stubGlobal("AudioContext", MockAudioContext);

    startLoopBeep(42);
    // 同一IDの再起動は無視される（インスタンスは1つだけ）
    startLoopBeep(42);
    expect(MockAudioContext).toHaveBeenCalledOnce();

    // 数サイクル分時間を進める
    await vi.advanceTimersByTimeAsync(2000);
    expect(startFn.mock.calls.length).toBeGreaterThan(0);

    stopLoopBeep(42);
    expect(closeFn).toHaveBeenCalledOnce();

    // stop 後は再起動可能
    startLoopBeep(42);
    expect(MockAudioContext).toHaveBeenCalledTimes(2);
  });
});

describe("playStartBeep", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("AudioContext が無い環境では警告ログを出力する", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    await expect(playStartBeep()).resolves.toBeUndefined();
    expect(warnSpy).toHaveBeenCalledOnce();
  });
});
