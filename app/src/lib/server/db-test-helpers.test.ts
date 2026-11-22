import { eq, inArray, sql } from "drizzle-orm";
import { afterAll, expect, it } from "vitest";

import {
  cleanupFixtures,
  createFixtureList,
  describeDb,
} from "./db-test-helpers";
import { getDb } from "./db";
import { lists, schedules, users } from "./schema";

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
