import { describe, expect, it } from "vitest";
import {
  formatLocalMinute,
  getTimezoneOffsetMinutes,
  pad2,
  SCHEDULE_TIMEZONE,
  SCHEDULE_UTC_OFFSET_MS,
} from "./date-time.ts";

describe("日時の共有定義", () => {
  it("ブラウザの時差をAPIの符号で返す", () => {
    expect(getTimezoneOffsetMinutes()).toBe(-new Date().getTimezoneOffset());
  });
  it("ローカルの分単位表示とCSVの日時形式をそろえる", () => {
    const value = new Date(2026, 0, 2, 3, 4);
    expect(formatLocalMinute(value)).toBe("2026/01/02 03:04");
    expect(formatLocalMinute(value.toISOString())).toBe("2026/01/02 03:04");
    expect(pad2(9)).toBe("09");
    expect(SCHEDULE_TIMEZONE).toBe("Asia/Tokyo");
    expect(SCHEDULE_UTC_OFFSET_MS).toBe(9 * 3600 * 1000);
  });
});
