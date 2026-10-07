/** 現地日時のUTC換算、30日窓、朝4時の区切りを境界で検証する。 */

import { describe, expect, it } from "vitest";

import {
  calculateWindow,
  countDays,
  dayStartOf,
  localMinuteToUtc,
  nextRunAt,
  parseLocalDate,
} from "#lib/calorie-date.ts";

describe("現地日時とカロリー記録の期間", () => {
  it.each([
    ["2026/01/01 00:00", 540, "2025-12-31T15:00:00.000Z"],
    ["2026/01/01 00:00", -720, "2026-01-01T12:00:00.000Z"],
    ["2026/01/01 00:00", 840, "2025-12-31T10:00:00.000Z"],
  ])("%sを時差%s分でUTCへ変換する", (value, offset, expected) => {
    expect(localMinuteToUtc(value, offset).toISOString()).toBe(expected);
  });

  it("現地の翌日0時を終端とする30日窓を、年と月を越えて接続する", () => {
    const now = new Date("2025-12-31T20:00:00.000Z");
    const first = calculateWindow(0, 540, now);
    const previous = calculateWindow(1, 540, now);
    expect(first.start.toISOString()).toBe("2025-12-02T15:00:00.000Z");
    expect(first.endExclusive.toISOString()).toBe("2026-01-01T15:00:00.000Z");
    expect(previous.endExclusive).toEqual(first.start);
    expect(
      countDays(parseLocalDate("2024/02/28"), parseLocalDate("2024/03/01")),
    ).toBe(3);
    expect(
      countDays(parseLocalDate("2026/09/03"), parseLocalDate("2026/09/01")),
    ).toBe(-1);
  });

  it("朝4時直前は前日の確定日に含め、4時ちょうどから新しい日を始める", () => {
    expect(
      dayStartOf(new Date("2026-08-31T18:59:59.999Z"), 540).toISOString(),
    ).toBe("2026-08-30T19:00:00.000Z");
    expect(
      dayStartOf(new Date("2026-08-31T19:00:00.000Z"), 540).toISOString(),
    ).toBe("2026-08-31T19:00:00.000Z");
  });

  it("指定時刻ちょうどの設定は翌日へ進め、直前なら当日へ置く", () => {
    expect(
      nextRunAt(
        "08:00",
        540,
        new Date("2026-08-31T22:59:59.999Z"),
      ).toISOString(),
    ).toBe("2026-08-31T23:00:00.000Z");
    expect(
      nextRunAt(
        "08:00",
        540,
        new Date("2026-08-31T23:00:00.000Z"),
      ).toISOString(),
    ).toBe("2026-09-01T23:00:00.000Z");
  });
});
