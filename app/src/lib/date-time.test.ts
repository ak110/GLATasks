import { describe, expect, it } from "vitest";
import {
  formatLocalMinute,
  getUtcOffsetMinutes,
  pad2,
  SCHEDULE_TIMEZONE,
  SCHEDULE_UTC_OFFSET_MS,
} from "./date-time.ts";

describe("日時の共有定義", () => {
  it("ブラウザの時差をAPIの符号で返す", () => {
    const now = new Date();
    // ローカルの年月日時分をUTCとして組み立て、実際のUTC時刻との差でAPIの符号を確認する。
    const localAsUtc = Date.UTC(
      now.getFullYear(),
      now.getMonth(),
      now.getDate(),
      now.getHours(),
      now.getMinutes(),
    );
    const utc = Date.UTC(
      now.getUTCFullYear(),
      now.getUTCMonth(),
      now.getUTCDate(),
      now.getUTCHours(),
      now.getUTCMinutes(),
    );
    // UTC環境の+0/-0は同じ時差として比較する。
    expect(getUtcOffsetMinutes()).toBeCloseTo((localAsUtc - utc) / 60000, 10);
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
