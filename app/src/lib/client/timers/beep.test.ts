import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  playStartBeep,
  startLoopBeep,
  stopLoopBeep,
  stopAllLoopBeeps,
} from "#lib/client/timers/beep.ts";

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
    startLoopBeep(1, 3);
    expect(warnSpy).toHaveBeenCalledOnce();
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

    startLoopBeep(42, 3600);
    startLoopBeep(42, 3600);
    expect(MockAudioContext).toHaveBeenCalledOnce();

    await vi.advanceTimersByTimeAsync(2000);
    expect(startFn.mock.calls.length).toBeGreaterThan(0);

    stopLoopBeep(42);
    expect(closeFn).toHaveBeenCalledOnce();

    startLoopBeep(42, 3600);
    expect(MockAudioContext).toHaveBeenCalledTimes(2);
  });

  it("ringSeconds 経過で自動的に停止する", async () => {
    const closeFn = vi.fn().mockResolvedValue(undefined);
    const MockAudioContext = vi.fn().mockImplementation(function () {
      return {
        currentTime: 0,
        destination: {},
        createOscillator: () => ({
          frequency: { value: 0 },
          connect: vi.fn(),
          start: vi.fn(),
          stop: vi.fn(),
        }),
        createGain: () => ({
          gain: { value: 0 },
          connect: vi.fn(),
        }),
        close: closeFn,
      };
    });
    vi.stubGlobal("AudioContext", MockAudioContext);

    startLoopBeep(7, 3);
    await vi.advanceTimersByTimeAsync(3000);
    expect(closeFn).toHaveBeenCalledOnce();
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
