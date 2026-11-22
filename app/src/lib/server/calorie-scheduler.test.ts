import { describe, expect, it } from "vitest";

import { DAY_MS } from "#lib/calorie-date.ts";
import { collectDueCalorieAutoRecordRuns } from "./calorie-scheduler";

describe("collectDueCalorieAutoRecordRuns", () => {
  const nextRunAt = new Date("2025-01-01T00:00:00.000Z");

  it("次回時刻ちょうどの1件を記録し、次回時刻を1日進める", () => {
    expect(collectDueCalorieAutoRecordRuns(nextRunAt, nextRunAt)).toEqual({
      consumedAts: [nextRunAt],
      nextRunAt: new Date(nextRunAt.getTime() + DAY_MS),
    });
  });

  it("複数日が過ぎた場合は1日刻みで全ての時刻を記録し、次回時刻をnowより後へ進める", () => {
    const now = new Date(nextRunAt.getTime() + 2 * DAY_MS + 1);
    expect(collectDueCalorieAutoRecordRuns(nextRunAt, now)).toEqual({
      consumedAts: [0, 1, 2].map(
        (day) => new Date(nextRunAt.getTime() + day * DAY_MS),
      ),
      nextRunAt: new Date(nextRunAt.getTime() + 3 * DAY_MS),
    });
  });
});
