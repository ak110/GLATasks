/**
 * @fileoverview `describeSchedule` の日本語要約文生成のユニットテスト
 *
 * DBアクセスを伴わない純粋関数のテストのため、vitest実行のみで完結する。
 */

import { describe, expect, it } from "vitest";
import { describeSchedule } from "./schedule-utils";

const DTSTART = "DTSTART;TZID=Asia/Tokyo:20260708T090000";

describe("describeSchedule", () => {
  it("毎日の要約文を生成する", () => {
    const rrule = `${DTSTART}\nRRULE:FREQ=DAILY;INTERVAL=1`;
    expect(describeSchedule(rrule)).toBe("毎日");
  });

  it("N日ごとの要約文を生成する", () => {
    const rrule = `${DTSTART}\nRRULE:FREQ=DAILY;INTERVAL=3`;
    expect(describeSchedule(rrule)).toBe("3日ごと");
  });

  it("毎週N曜日の要約文を生成する", () => {
    const rrule = `${DTSTART}\nRRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO`;
    expect(describeSchedule(rrule)).toBe("毎週月曜日");
  });

  it("毎週複数曜日の要約文を生成する", () => {
    const rrule = `${DTSTART}\nRRULE:FREQ=WEEKLY;INTERVAL=1;BYDAY=MO,WE,FR`;
    expect(describeSchedule(rrule)).toBe("毎週月曜日・水曜日・金曜日");
  });

  it("N週間毎の要約文を生成する", () => {
    const rrule = `${DTSTART}\nRRULE:FREQ=WEEKLY;INTERVAL=2`;
    expect(describeSchedule(rrule)).toBe("2週間ごと");
  });

  it("2週間ごとの月曜の要約文を生成する", () => {
    const rrule = `${DTSTART}\nRRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO`;
    expect(describeSchedule(rrule)).toBe("2週間ごとの月曜日");
  });

  it("毎月N日の要約文を生成する", () => {
    const rrule = `${DTSTART}\nRRULE:FREQ=MONTHLY;INTERVAL=1;BYMONTHDAY=15`;
    expect(describeSchedule(rrule)).toBe("毎月15日");
  });

  it("2か月ごとの15日の要約文を生成する", () => {
    const rrule = `${DTSTART}\nRRULE:FREQ=MONTHLY;INTERVAL=2;BYMONTHDAY=15`;
    expect(describeSchedule(rrule)).toBe("2か月ごとの15日");
  });

  it("毎月第N曜日目の要約文を生成する", () => {
    const rrule = `${DTSTART}\nRRULE:FREQ=MONTHLY;INTERVAL=1;BYDAY=+2MO`;
    expect(describeSchedule(rrule)).toBe("毎月第2月曜日");
  });

  it("毎年の要約文を生成する", () => {
    const rrule = `${DTSTART}\nRRULE:FREQ=YEARLY;INTERVAL=1;BYMONTH=1;BYMONTHDAY=1`;
    expect(describeSchedule(rrule)).toBe("毎年1月1日");
  });

  it("2年ごとの3月15日の要約文を生成する", () => {
    const rrule = `${DTSTART}\nRRULE:FREQ=YEARLY;INTERVAL=2;BYMONTH=3;BYMONTHDAY=15`;
    expect(describeSchedule(rrule)).toBe("2年ごとの3月15日");
  });
});
