/**
 * @fileoverview タイマー純粋関数のユニットテスト
 *
 * DB 依存がない calcAlarmRemainingSeconds / calcAlarmSecondsOrThrow を対象にする。
 * 現在時刻に依存するため vi.useFakeTimers() で時刻を固定する。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  calcAlarmRemainingSeconds,
  calcAlarmSecondsOrThrow,
} from "./timers.js";

/**
 * 固定時刻でのアラーム残り秒数を計算する補助関数。
 *
 * @param nowIso - 現在時刻（ISO 8601 UTC 文字列）
 * @param targetMinutes - ターゲット時刻（現地時間の分数: 0〜1439）
 * @param tzOffsetMinutes - タイムゾーンオフセット（分）
 */
function calcWithFixedTime(
  nowIso: string,
  targetMinutes: number,
  tzOffsetMinutes: number,
): number {
  vi.setSystemTime(new Date(nowIso));
  return calcAlarmRemainingSeconds(targetMinutes, tzOffsetMinutes);
}

describe("calcAlarmRemainingSeconds", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("ターゲット時刻が現在より未来の場合は正の秒数を返す", () => {
    // UTC 12:00:00、JST(+9h=+540min) では 21:00:00
    // ターゲット: JST 22:00 = 22*60=1320分
    // 残り: 60分 = 3600秒
    const remaining = calcWithFixedTime(
      "2025-01-01T12:00:00.000Z",
      22 * 60,
      540,
    );
    expect(remaining).toBe(3600);
  });

  it("ターゲット時刻が現在と同分で秒が0のとき残り0秒", () => {
    // UTC 12:00:00、JST 21:00:00
    // ターゲット: JST 21:00 = 21*60=1260分、秒=0
    // diffMinutes=0、nowLocalSeconds=0 → 条件未達で 24h 加算なし → 0秒
    const remaining = calcWithFixedTime(
      "2025-01-01T12:00:00.000Z",
      21 * 60,
      540,
    );
    expect(remaining).toBe(0);
  });

  it("ターゲット時刻が過去（現地時間）の場合は翌日分を返す", () => {
    // UTC 12:00:00、JST 21:00:00
    // ターゲット: JST 10:00 = 600分（現地時間で過去）
    // 翌日 10:00 まで: (24*60 - (21*60 - 10*60)) = 24*60 - 11*60 = 13*60分 = 780分 = 46800秒
    const remaining = calcWithFixedTime(
      "2025-01-01T12:00:00.000Z",
      10 * 60,
      540,
    );
    expect(remaining).toBe(13 * 60 * 60);
  });

  it("ターゲット時刻が同分で秒が0より大きいとき翌日分になる", () => {
    // UTC 12:00:30、JST 21:00:30
    // ターゲット: JST 21:00（同じ時・分だが秒が過ぎている）
    // → 翌日の JST 21:00 まで: 24*60*60 - 30秒
    const remaining = calcWithFixedTime(
      "2025-01-01T12:00:30.000Z",
      21 * 60,
      540,
    );
    expect(remaining).toBe(24 * 60 * 60 - 30);
  });

  it("UTC オフセット0（UTC 直接）でも正しく計算する", () => {
    // UTC 10:00:00、ターゲット: UTC 11:00 = 660分
    // 残り: 60分 = 3600秒
    const remaining = calcWithFixedTime("2025-01-01T10:00:00.000Z", 11 * 60, 0);
    expect(remaining).toBe(3600);
  });

  it("マイナスオフセット（例: UTC-5）でも正しく計算する", () => {
    // UTC 15:00:00、EST(-5h=-300min) では 10:00:00
    // ターゲット: EST 12:00 = 720分
    // 残り: 120分 = 7200秒
    const remaining = calcWithFixedTime(
      "2025-01-01T15:00:00.000Z",
      12 * 60,
      -300,
    );
    expect(remaining).toBe(7200);
  });
});

describe("calcAlarmSecondsOrThrow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-01T12:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("target_minutes と tzOffsetMinutes が両方指定されているとき正常に計算する", () => {
    // JST(+540) 21:00:00 → ターゲット JST 22:00 = 3600秒後
    const result = calcAlarmSecondsOrThrow(22 * 60, 540);
    expect(result).toBe(3600);
  });

  it("target_minutes が null のとき alarm_missing_params をスローする", () => {
    expect(() => calcAlarmSecondsOrThrow(null, 540)).toThrowError(
      "alarm_missing_params",
    );
  });

  it("target_minutes が undefined のとき alarm_missing_params をスローする", () => {
    expect(() => calcAlarmSecondsOrThrow(undefined, 540)).toThrowError(
      "alarm_missing_params",
    );
  });

  it("tzOffsetMinutes が null のとき alarm_missing_params をスローする", () => {
    expect(() => calcAlarmSecondsOrThrow(22 * 60, null)).toThrowError(
      "alarm_missing_params",
    );
  });

  it("tzOffsetMinutes が undefined のとき alarm_missing_params をスローする", () => {
    expect(() => calcAlarmSecondsOrThrow(22 * 60, undefined)).toThrowError(
      "alarm_missing_params",
    );
  });

  it("両方 null のとき alarm_missing_params をスローする", () => {
    expect(() => calcAlarmSecondsOrThrow(null, null)).toThrowError(
      "alarm_missing_params",
    );
  });
});
