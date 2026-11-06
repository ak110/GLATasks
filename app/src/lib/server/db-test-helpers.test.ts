/**
 * @fileoverview fixture回収（`cleanupFixtures`）が回収中の同時更新で失敗しないことの試験。
 *
 * 定期処理（`processSchedules`）は全リストの有効な予定を走査して`last_fired`を更新するため、
 * 同じ試験用DBを使う別の実行が、回収中のfixtureの予定を更新しうる。
 * 回収transactionの最初の読み取りの後に別の接続から予定を更新し、分離レベルごとの結果を比べる。
 */

import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, expect, it } from "vitest";

import {
  cleanupFixtures,
  createFixtureList,
  describeDb,
} from "./db-test-helpers";
import { getDb } from "./db";
import { lists, schedules, users } from "./schema";

/** 有効な予定を1件持つfixtureを作り、利用者・リスト・予定のidを返す。 */
async function createFixtureWithSchedule() {
  const { userId, listId } = await createFixtureList();
  const now = new Date();
  const [{ id: scheduleId }] = await getDb()
    .insert(schedules)
    .values({
      list_id: listId,
      title: "回収試験の予定",
      tags: "[]",
      rrule: "DTSTART;TZID=Asia/Tokyo:20260101T090000\nRRULE:FREQ=DAILY",
      last_fired: null,
      enabled: 1,
      sort_order: 0,
      created: now,
      updated: now,
    })
    .$returningId();
  return { userId, listId, scheduleId };
}

/** 別の接続から、定期処理と同じ更新（`last_fired`・`updated`）を予定へ加える。 */
async function updateScheduleConcurrently(scheduleId: number): Promise<void> {
  const fired = new Date("2026-01-05T00:00:00.000Z");
  await getDb()
    .update(schedules)
    .set({ last_fired: fired, updated: fired })
    .where(eq(schedules.id, scheduleId));
}

async function snapshotIsolationEnabled(): Promise<boolean> {
  const [rows] = (await getDb().execute(
    sql`SELECT @@innodb_snapshot_isolation AS enabled`,
  )) as unknown as [Array<{ enabled: number | string }>];
  return Number(rows[0]?.enabled) === 1;
}

describeDb("fixture回収と同時更新", () => {
  const leftovers: number[] = [];

  afterAll(async () => {
    await cleanupFixtures(leftovers);
  });

  it("REPEATABLE READでは回収中の予定の更新で削除が失敗し、既定の回収は成功する", async () => {
    const before = await createFixtureWithSchedule();
    leftovers.push(before.userId);
    const repeatable = cleanupFixtures([before.userId], {
      isolationLevel: "repeatable read",
      afterFirstRead: () => updateScheduleConcurrently(before.scheduleId),
    });
    if (await snapshotIsolationEnabled()) {
      // 修正前の分離レベルでは、元の診断と同じ`ER_CHECKREAD`で回収が失敗する。
      await expect(repeatable).rejects.toMatchObject({
        cause: expect.objectContaining({ code: "ER_CHECKREAD" }),
      });
    } else {
      await repeatable;
    }

    const after = await createFixtureWithSchedule();
    await cleanupFixtures([after.userId], {
      afterFirstRead: () => updateScheduleConcurrently(after.scheduleId),
    });
    const db = getDb();
    expect(
      await db
        .select()
        .from(schedules)
        .where(eq(schedules.id, after.scheduleId)),
    ).toEqual([]);
    expect(
      await db.select().from(lists).where(eq(lists.id, after.listId)),
    ).toEqual([]);
    expect(
      await db
        .select()
        .from(users)
        .where(inArray(users.id, [after.userId])),
    ).toEqual([]);
  });
});
