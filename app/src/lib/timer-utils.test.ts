/**
 * @fileoverview タイマー残り時間計算のテスト
 */

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  calcTimerRemainingMs,
  formatTime,
  parseTimeInput,
  formatTargetTime,
  parseTargetTime,
  calcSecondsUntilTarget,
} from "./timer-utils";
import type { TimerInfo } from "$lib/types";

/** テスト用のタイマー情報を生成する */
function makeTimer(overrides: Partial<TimerInfo> = {}): TimerInfo {
  return {
    id: 1,
    name: "テスト",
    mode: "countdown" as const,
    target_minutes: null,
    base_seconds: 300,
    adjust_minutes: 5,
    running: false,
    expired: false,
    ephemeral: false,
    keep_ringing: false,
    remaining_seconds: 300,
    started_at: null,
    sort_order: 0,
    ...overrides,
  };
}

describe("calcTimerRemainingMs", () => {
  afterEach(() => vi.useRealTimers());

  it("停止中のタイマーは remaining_seconds をミリ秒で返す", () => {
    const timer = makeTimer({ remaining_seconds: 120 });
    expect(calcTimerRemainingMs(timer, 0)).toBe(120_000);
  });

  it("running で started_at が null の場合は remaining_seconds をミリ秒で返す", () => {
    const timer = makeTimer({ running: true, started_at: null });
    expect(calcTimerRemainingMs(timer, 0)).toBe(300_000);
  });

  it("running 中は経過時間を差し引いた残りミリ秒を返す", () => {
    vi.useFakeTimers({ now: 10_000 });
    const timer = makeTimer({
      running: true,
      remaining_seconds: 60,
      started_at: new Date(7_000).toISOString(), // 3秒前に開始
    });
    expect(calcTimerRemainingMs(timer, 0)).toBe(57_000);
  });

  it("サーバーオフセットが計算に反映される", () => {
    vi.useFakeTimers({ now: 10_000 });
    const timer = makeTimer({
      running: true,
      remaining_seconds: 60,
      started_at: new Date(7_000).toISOString(),
    });
    // オフセット +2000ms → サーバー時刻は 12秒 → 経過5秒 → 残り55秒
    expect(calcTimerRemainingMs(timer, 2_000)).toBe(55_000);
  });

  it("残り時間が負にならない（0でクランプ）", () => {
    vi.useFakeTimers({ now: 100_000 });
    const timer = makeTimer({
      running: true,
      remaining_seconds: 10,
      started_at: new Date(0).toISOString(), // 100秒前
    });
    expect(calcTimerRemainingMs(timer, 0)).toBe(0);
  });
});

describe("formatTime", () => {
  it("0秒を 00:00:00 にフォーマットする", () => {
    expect(formatTime(0)).toBe("00:00:00");
  });

  it("秒のみを正しくフォーマットする", () => {
    expect(formatTime(45)).toBe("00:00:45");
  });

  it("分と秒を正しくフォーマットする", () => {
    expect(formatTime(150)).toBe("00:02:30");
  });

  it("時・分・秒を正しくフォーマットする", () => {
    expect(formatTime(3661)).toBe("01:01:01");
  });

  it("大きい値を正しくフォーマットする", () => {
    expect(formatTime(359999)).toBe("99:59:59");
  });
});

describe("parseTimeInput", () => {
  it("HH:MM:SS 形式をパースする", () => {
    expect(parseTimeInput("01:30:00")).toBe(5400);
  });

  it("MM:SS 形式をパースする", () => {
    expect(parseTimeInput("05:30")).toBe(330);
  });

  it("SS 形式をパースする", () => {
    expect(parseTimeInput("90")).toBe(90);
  });

  it("00:00:00 は 0 を返す", () => {
    expect(parseTimeInput("00:00:00")).toBe(0);
  });

  it("前後の空白を無視する", () => {
    expect(parseTimeInput("  01:00:00  ")).toBe(3600);
  });

  it("空文字列は null を返す", () => {
    expect(parseTimeInput("")).toBeNull();
  });

  it("不正な文字列は null を返す", () => {
    expect(parseTimeInput("abc")).toBeNull();
  });

  it("負の値は null を返す", () => {
    expect(parseTimeInput("-1:00")).toBeNull();
  });

  it("上限を超える値は null を返す", () => {
    expect(parseTimeInput("100:00:00")).toBeNull();
  });

  it("4パート以上は null を返す", () => {
    expect(parseTimeInput("1:2:3:4")).toBeNull();
  });
});

describe("formatTargetTime", () => {
  it("0を 00:00 にフォーマットする", () => {
    expect(formatTargetTime(0)).toBe("00:00");
  });

  it("870を 14:30 にフォーマットする", () => {
    expect(formatTargetTime(870)).toBe("14:30");
  });

  it("1439を 23:59 にフォーマットする", () => {
    expect(formatTargetTime(1439)).toBe("23:59");
  });
});

describe("parseTargetTime", () => {
  it("14:30 を 870 にパースする", () => {
    expect(parseTargetTime("14:30")).toBe(870);
  });

  it("0:00 を 0 にパースする", () => {
    expect(parseTargetTime("0:00")).toBe(0);
  });

  it("23:59 を 1439 にパースする", () => {
    expect(parseTargetTime("23:59")).toBe(1439);
  });

  it("24:00 は null を返す", () => {
    expect(parseTargetTime("24:00")).toBeNull();
  });

  it("abc は null を返す", () => {
    expect(parseTargetTime("abc")).toBeNull();
  });

  it("空文字列は null を返す", () => {
    expect(parseTargetTime("")).toBeNull();
  });

  it("前後の空白を無視する", () => {
    expect(parseTargetTime("  08:15  ")).toBe(495);
  });
});

describe("calcSecondsUntilTarget", () => {
  afterEach(() => vi.useRealTimers());

  it("目標が今日の後の場合、今日の残り秒数を返す", () => {
    // 14:00:00 に設定、目標は 15:30 → 残り 90分 = 5400秒
    vi.useFakeTimers({ now: new Date(2026, 2, 18, 14, 0, 0, 0).getTime() });
    expect(calcSecondsUntilTarget(15 * 60 + 30)).toBe(5400);
  });

  it("目標が過ぎた場合、翌日の目標までの秒数を返す", () => {
    // 15:00:00 に設定、目標は 14:30 → 残り 23時間30分 = 84600秒
    vi.useFakeTimers({ now: new Date(2026, 2, 18, 15, 0, 0, 0).getTime() });
    expect(calcSecondsUntilTarget(14 * 60 + 30)).toBe(84600);
  });

  it("目標がちょうど現在時刻と同じ分だが秒が過ぎている場合、翌日になる", () => {
    // 14:30:10 に設定、目標は 14:30 → 翌日の 14:30 まで
    vi.useFakeTimers({ now: new Date(2026, 2, 18, 14, 30, 10, 0).getTime() });
    expect(calcSecondsUntilTarget(14 * 60 + 30)).toBe(24 * 3600 - 10);
  });
});
