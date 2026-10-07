/** 集計に必要な記録と設定を取得し、純粋な集計関数へ渡す。 */

import { and, asc, eq, gte, lte } from "drizzle-orm";
import {
  calculateCalorieSummary,
  calorieSummaryStart,
  recordTotalKcal,
} from "#lib/calorie-summary.ts";
import { DEFAULT_CALORIE_GOAL_KCAL } from "#lib/schemas.ts";
import { getDb } from "../db";
import { calorieItems, calorieRecords } from "../schema";
import { ownRecordCondition } from "./calories-crud";
import { getUserPreferences } from "./users";

export async function getCalorieSummary(
  userId: number,
  tzOffsetMinutes: number,
  now = new Date(),
) {
  const start = calorieSummaryStart(now, tzOffsetMinutes);
  const recordRows = await getDb()
    .select({
      consumedAt: calorieRecords.consumed_at,
      quantity: calorieRecords.quantity,
      itemKcal: calorieItems.kcal,
      temporaryName: calorieRecords.temporary_name,
    })
    .from(calorieRecords)
    .leftJoin(calorieItems, eq(calorieItems.id, calorieRecords.item_id))
    .where(
      and(
        ownRecordCondition(userId),
        gte(calorieRecords.consumed_at, start),
        lte(calorieRecords.consumed_at, now),
      ),
    );
  const rows = recordRows.map((row) => ({
    consumedAt: row.consumedAt,
    totalKcal: recordTotalKcal(row),
  }));
  const [firstRecord] = await getDb()
    .select({ consumedAt: calorieRecords.consumed_at })
    .from(calorieRecords)
    .where(eq(calorieRecords.user_id, userId))
    .orderBy(asc(calorieRecords.consumed_at))
    .limit(1);
  const preferences = await getUserPreferences(userId);
  const goal = preferences.calorieGoalKcal ?? DEFAULT_CALORIE_GOAL_KCAL;
  return calculateCalorieSummary(
    rows,
    firstRecord?.consumedAt,
    goal,
    now,
    tzOffsetMinutes,
  );
}
