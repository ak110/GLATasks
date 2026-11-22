import { describe, expect, it } from "vitest";

import {
  calcAlarmRemainingSeconds,
  calcAlarmSecondsOrThrow,
} from "./timers.js";

function calcWithFixedTime(
  nowIso: string,
  targetMinutes: number,
  tzOffsetMinutes: number,
): number {
  return calcAlarmRemainingSeconds(
    targetMinutes,
    tzOffsetMinutes,
    Date.parse(nowIso),
  );
}

describe("calcAlarmRemainingSeconds", () => {
  it("ターゲット時刻が現在より未来の場合は正の秒数を返す", () => {
    const remaining = calcWithFixedTime(
      "2025-01-01T12:00:00.000Z",
      22 * 60,
      540,
    );
    expect(remaining).toBe(3600);
  });

  it("ターゲット時刻が現在と同分で秒が0のとき残り0秒", () => {
    const remaining = calcWithFixedTime(
      "2025-01-01T12:00:00.000Z",
      21 * 60,
      540,
    );
    expect(remaining).toBe(0);
  });

  it("ターゲット時刻が過去（現地時間）の場合は翌日分を返す", () => {
    const remaining = calcWithFixedTime(
      "2025-01-01T12:00:00.000Z",
      10 * 60,
      540,
    );
    expect(remaining).toBe(13 * 60 * 60);
  });

  it("ターゲット時刻が同分で秒が0より大きいとき翌日分になる", () => {
    const remaining = calcWithFixedTime(
      "2025-01-01T12:00:30.000Z",
      21 * 60,
      540,
    );
    expect(remaining).toBe(24 * 60 * 60 - 30);
  });

  it("UTC オフセット0（UTC 直接）でも正しく計算する", () => {
    const remaining = calcWithFixedTime("2025-01-01T10:00:00.000Z", 11 * 60, 0);
    expect(remaining).toBe(3600);
  });

  it("マイナスオフセット（例: UTC-5）でも正しく計算する", () => {
    const remaining = calcWithFixedTime(
      "2025-01-01T15:00:00.000Z",
      12 * 60,
      -300,
    );
    expect(remaining).toBe(7200);
  });
});

describe("calcAlarmSecondsOrThrow", () => {
  const nowUtcMs = Date.parse("2025-01-01T12:00:00.000Z");

  it("target_minutes と tzOffsetMinutes が両方指定されているとき正常に計算する", () => {
    const result = calcAlarmSecondsOrThrow(22 * 60, 540, nowUtcMs);
    expect(result).toBe(3600);
  });

  it("target_minutes が null のとき alarm_missing_params をスローする", () => {
    expect(() => calcAlarmSecondsOrThrow(null, 540, nowUtcMs)).toThrowError(
      "alarm_missing_params",
    );
  });

  it("target_minutes が undefined のとき alarm_missing_params をスローする", () => {
    expect(() =>
      calcAlarmSecondsOrThrow(undefined, 540, nowUtcMs),
    ).toThrowError("alarm_missing_params");
  });

  it("tzOffsetMinutes が null のとき alarm_missing_params をスローする", () => {
    expect(() => calcAlarmSecondsOrThrow(22 * 60, null, nowUtcMs)).toThrowError(
      "alarm_missing_params",
    );
  });

  it("tzOffsetMinutes が undefined のとき alarm_missing_params をスローする", () => {
    expect(() =>
      calcAlarmSecondsOrThrow(22 * 60, undefined, nowUtcMs),
    ).toThrowError("alarm_missing_params");
  });

  it("両方 null のとき alarm_missing_params をスローする", () => {
    expect(() => calcAlarmSecondsOrThrow(null, null, nowUtcMs)).toThrowError(
      "alarm_missing_params",
    );
  });
});
