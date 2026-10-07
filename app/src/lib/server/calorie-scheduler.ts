/** スケジューラーが呼ぶカロリー自動記録の定期処理。 */

import { and, eq, lte } from "drizzle-orm";
import { DAY_MS } from "#lib/calorie-date.ts";
import { getDb } from "./db";
import { calorieAutoRecords, calorieRecords } from "./schema";

/**
 * ONの自動記録設定のうち次回時刻が`now`以前のものについて、過ぎた時刻ごとに記録を追加し、
 * 記録を追加したユーザーのIDと、全設定を正常に処理できたかを返す。
 *
 * 次回時刻から1日刻みで`now`以前の時刻を記録し、次回時刻を`now`より後へ進める。
 * 1件の失敗が他の設定の処理を止めないよう、設定ごとに例外を捕捉する。
 * 単一プロセスから60秒間隔で呼ばれる前提であり、並行呼び出しの排他は持たない。
 */
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
      const consumedAts: Date[] = [];
      let next = rule.next_run_at.getTime();
      while (next <= now.getTime()) {
        consumedAts.push(new Date(next));
        next += DAY_MS;
      }
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
          .set({ next_run_at: new Date(next) })
          .where(eq(calorieAutoRecords.id, rule.id));
      });
      notifiedUserIds.add(rule.user_id);
    } catch (error) {
      succeeded = false;
      console.error(
        `[scheduler] カロリー自動記録 ${rule.id} の処理に失敗しました`,
        error,
      );
    }
  }
  return { userIds: [...notifiedUserIds], succeeded };
}
