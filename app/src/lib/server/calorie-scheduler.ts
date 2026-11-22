import { and, eq, lte } from "drizzle-orm";
import { DAY_MS } from "#lib/calorie-date.ts";
import { getDb } from "./db";
import { calorieAutoRecords, calorieRecords } from "./schema";

export function collectDueCalorieAutoRecordRuns(
  nextRunAt: Date,
  now: Date,
): { consumedAts: Date[]; nextRunAt: Date } {
  const consumedAts: Date[] = [];
  let next = nextRunAt.getTime();
  while (next <= now.getTime()) {
    consumedAts.push(new Date(next));
    next += DAY_MS;
  }
  return { consumedAts, nextRunAt: new Date(next) };
}

export async function processCalorieAutoRecords(
  now: Date,
): Promise<{ userIds: number[]; succeeded: boolean }> {
  const db = getDb();
  const rules = await db
    .select()
    .from(calorieAutoRecords)
    .where(
      and(
        eq(calorieAutoRecords.enabled, 1),
        lte(calorieAutoRecords.next_run_at, now),
      ),
    );
  const notifiedUserIds = new Set<number>();
  let succeeded = true;
  for (const rule of rules) {
    try {
      const { consumedAts, nextRunAt } = collectDueCalorieAutoRecordRuns(
        rule.next_run_at,
        now,
      );
      await db.transaction(async (tx) => {
        await tx.insert(calorieRecords).values(
          consumedAts.map((consumedAt) => ({
            user_id: rule.user_id,
            item_id: rule.item_id,
            consumed_at: consumedAt,
            quantity: rule.quantity,
            created: now,
            updated: now,
          })),
        );
        await tx
          .update(calorieAutoRecords)
          .set({ next_run_at: nextRunAt })
          .where(eq(calorieAutoRecords.id, rule.id));
      });
      notifiedUserIds.add(rule.user_id);
    } catch (error) {
      succeeded = false;
      console.error(
        `[scheduler] カロリー自動記録 ${rule.id} の処理に失敗しました。他の設定の処理は続け、この設定は次の周期で再試行します。続く例外とDBの状態を確認してください`,
        error,
      );
    }
  }
  return { userIds: [...notifiedUserIds], succeeded };
}
