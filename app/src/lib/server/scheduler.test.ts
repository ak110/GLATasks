import { eq } from "drizzle-orm";
import { afterAll, expect, it, vi } from "vitest";

import {
  createFixtureList,
  cleanupFixtures,
  describeDb,
} from "./db-test-helpers";
import { getDb } from "./db";
import { schedules, tasks } from "./schema";
import { processSchedules } from "./scheduler";

async function insertSchedule(params: {
  listId: number;
  rrule: string;
  created: Date;
  lastFired?: Date | null;
}): Promise<number> {
  const db = getDb();
  const now = new Date();
  const result = await db
    .insert(schedules)
    .values({
      list_id: params.listId,
      title: "定期TODOテスト",
      tags: "[]",
      rrule: params.rrule,
      last_fired: params.lastFired ?? null,
      enabled: 1,
      sort_order: 0,
      created: params.created,
      updated: now,
    })
    .$returningId();
  return result[0]!.id;
}

async function getLastFired(scheduleId: number): Promise<string | undefined> {
  const rows = await getDb()
    .select({ last_fired: schedules.last_fired })
    .from(schedules)
    .where(eq(schedules.id, scheduleId))
    .limit(1);
  return rows[0]?.last_fired?.toISOString();
}

async function countTodoTasks(listId: number): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(eq(tasks.list_id, listId));
  return rows.length;
}

describeDb("processSchedules", () => {
  const createdUserIds: number[] = [];

  vi.setConfig({ testTimeout: 20_000 });

  afterAll(async () => {
    await cleanupFixtures(createdUserIds);
  });

  it("フィルフォワードで未発火分がまとめて生成される", async () => {
    const { userId, listId } = await createFixtureList();
    createdUserIds.push(userId);

    const rrule =
      "DTSTART;TZID=Asia/Tokyo:20260101T090000\nRRULE:FREQ=DAILY;INTERVAL=1";
    await insertSchedule({
      listId,
      rrule,
      created: new Date("2026-01-01T00:00:00.000Z"),
    });

    await processSchedules(new Date("2026-01-05T00:00:00.000Z"));

    expect(await countTodoTasks(listId)).toBe(5);
  });

  it("フィルフォワード上限30件を超える分はスキップされ、last_fired が実際の最終発火予定まで進む", async () => {
    const { userId, listId } = await createFixtureList();
    createdUserIds.push(userId);

    const rrule =
      "DTSTART;TZID=Asia/Tokyo:20000101T090000\nRRULE:FREQ=DAILY;INTERVAL=1";
    const scheduleId = await insertSchedule({
      listId,
      rrule,
      created: new Date("2000-01-01T00:00:00.000Z"),
    });

    const now = new Date("2026-01-01T00:00:00.000Z");
    await processSchedules(now);

    expect(await countTodoTasks(listId)).toBe(30);

    const db = getDb();
    const rows = await db
      .select({ last_fired: schedules.last_fired })
      .from(schedules)
      .where(eq(schedules.id, scheduleId))
      .limit(1);
    expect(rows[0]!.last_fired?.toISOString()).toBe("2026-01-01T00:00:00.000Z");

    await db
      .update(schedules)
      .set({ enabled: 0 })
      .where(eq(schedules.id, scheduleId));
  });

  it("同一 now での2回目の呼び出しは重複発火しない", async () => {
    const { userId, listId } = await createFixtureList();
    createdUserIds.push(userId);

    const rrule =
      "DTSTART;TZID=Asia/Tokyo:20260101T090000\nRRULE:FREQ=DAILY;INTERVAL=1";
    await insertSchedule({
      listId,
      rrule,
      created: new Date("2026-01-01T00:00:00.000Z"),
    });

    const now = new Date("2026-01-05T00:00:00.000Z");
    await processSchedules(now);
    const firstCount = await countTodoTasks(listId);
    expect(firstCount).toBe(5);

    await processSchedules(now);
    const secondCount = await countTodoTasks(listId);
    expect(secondCount).toBe(firstCount);
  });

  it("DTSTART・TZID・UNTILを含むrruleが正しく保存・復元される", async () => {
    const { userId, listId } = await createFixtureList();
    createdUserIds.push(userId);

    const rrule =
      "DTSTART;TZID=Asia/Tokyo:20260201T090000\n" +
      "RRULE:FREQ=DAILY;INTERVAL=1;UNTIL=20260203T090000Z";
    await insertSchedule({
      listId,
      rrule,
      created: new Date("2026-01-31T00:00:00.000Z"),
    });

    await processSchedules(new Date("2026-03-01T00:00:00.000Z"));

    expect(await countTodoTasks(listId)).toBe(3);
  });

  it("時刻帯の変換前に9時間遅れで記録されたlast_firedから、重複も欠落もなく生成する", async () => {
    const { userId, listId } = await createFixtureList();
    createdUserIds.push(userId);

    const rrule =
      "DTSTART;TZID=Asia/Tokyo:20251201T090000\nRRULE:FREQ=DAILY;INTERVAL=1";
    const scheduleId = await insertSchedule({
      listId,
      rrule,
      created: new Date("2025-12-01T00:00:00.000Z"),
      lastFired: new Date("2025-12-04T09:00:00.000Z"),
    });

    const now = new Date("2025-12-06T00:30:00.000Z");
    await processSchedules(now);
    expect(await countTodoTasks(listId)).toBe(2);
    expect(await getLastFired(scheduleId)).toBe("2025-12-06T00:00:00.000Z");

    await processSchedules(now);
    expect(await countTodoTasks(listId)).toBe(2);
  });

  it.each([
    {
      label: "週次（毎週月曜の日本時間9:00）",
      rrule:
        "DTSTART;TZID=Asia/Tokyo:20251201T090000\nRRULE:FREQ=WEEKLY;BYDAY=MO",
      created: "2025-11-30T00:00:00.000Z",
      now: "2025-12-15T00:00:00.000Z",
      expectedCount: 3,
      expectedLastFired: "2025-12-15T00:00:00.000Z",
    },
    {
      label: "月次（毎月15日の日本時間9:00）",
      rrule: "DTSTART;TZID=Asia/Tokyo:20250915T090000\nRRULE:FREQ=MONTHLY",
      created: "2025-09-01T00:00:00.000Z",
      now: "2025-11-15T00:00:00.000Z",
      expectedCount: 3,
      expectedLastFired: "2025-11-15T00:00:00.000Z",
    },
  ])(
    "last_fired未設定の予定（$label）を日本時間で生成し、last_firedへ真の時刻を記録する",
    async ({ rrule, created, now, expectedCount, expectedLastFired }) => {
      const { userId, listId } = await createFixtureList();
      createdUserIds.push(userId);

      const scheduleId = await insertSchedule({
        listId,
        rrule,
        created: new Date(created),
      });

      await processSchedules(new Date(now));
      expect(await countTodoTasks(listId)).toBe(expectedCount);
      expect(await getLastFired(scheduleId)).toBe(expectedLastFired);
    },
  );

  it("1件のrrule不正で例外が起きても、他の正常スケジュールの発火は継続する", async () => {
    const { userId, listId } = await createFixtureList();
    createdUserIds.push(userId);

    await insertSchedule({
      listId,
      rrule: "DTSTART:INVALID\nRRULE:FREQ=DAILY",
      created: new Date("2026-01-01T00:00:00.000Z"),
    });
    const validRrule =
      "DTSTART;TZID=Asia/Tokyo:20260101T090000\nRRULE:FREQ=DAILY;INTERVAL=1";
    await insertSchedule({
      listId,
      rrule: validRrule,
      created: new Date("2026-01-01T00:00:00.000Z"),
    });

    await processSchedules(new Date("2026-01-05T00:00:00.000Z"));

    expect(await countTodoTasks(listId)).toBe(5);
  });
});
