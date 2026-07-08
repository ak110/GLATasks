/**
 * @fileoverview 定期TODOスケジューラー（`processSchedules`）の発火・フィルフォワード・
 * 重複防止ロジックのテスト。
 *
 * 開発用MariaDBへ実接続して検証する（`DATABASE_URL`が到達可能な環境で実行する）。
 * `now` を明示的に引数として渡し、実時刻に依存しないテストとする。
 */

import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { getDb } from "./db";
import { lists, schedules, tasks, users } from "./schema";
import { processSchedules } from "./scheduler";

/** テスト用ユーザー・リストを1組作成する。 */
async function createFixtureList(): Promise<{
  userId: number;
  listId: number;
}> {
  const db = getDb();
  const now = new Date();
  const [{ id: userId }] = await db
    .insert(users)
    .values({
      user: `sched${Math.random().toString(36).slice(2, 12)}`,
      pass_hash: "dummy",
      joined: now,
    })
    .$returningId();
  const [{ id: listId }] = await db
    .insert(lists)
    .values({
      user_id: userId,
      status: "active",
      title: "scheduler test list",
      sort_order: 0,
      last_updated: now,
    })
    .$returningId();
  return { userId, listId };
}

/** テスト用スケジュールを1件作成し、idを返す。 */
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

/** 指定リストに生成された kind="todo" タスクの件数を取得する。 */
async function countTodoTasks(listId: number): Promise<number> {
  const db = getDb();
  const rows = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(eq(tasks.list_id, listId));
  return rows.length;
}

/** テストで作成した users・lists・schedules・tasks 行を削除する。 */
async function cleanupFixtures(userIds: number[]): Promise<void> {
  if (userIds.length === 0) return;
  const db = getDb();
  const listRows = await db
    .select({ id: lists.id })
    .from(lists)
    .where(inArray(lists.user_id, userIds));
  const listIds = listRows.map((l) => l.id);
  if (listIds.length > 0) {
    await db.delete(schedules).where(inArray(schedules.list_id, listIds));
    await db.delete(tasks).where(inArray(tasks.list_id, listIds));
    await db.delete(lists).where(inArray(lists.id, listIds));
  }
  await db.delete(users).where(inArray(users.id, userIds));
}

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

describeDb("processSchedules", () => {
  const createdUserIds: number[] = [];

  // postTask は発火予定1件ごとに直列でDB往復するため、既定の5秒では
  // フィルフォワード検証（最大30件）が実行環境によってはタイムアウトする
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

    // 01-01, 01-02, 01-03, 01-04, 01-05 (09:00 JST = 00:00 UTC) の5回分を検出する想定。
    // 初回チェックのため created ちょうどに一致する 01-01 分も未発火として境界に含み、
    // now ちょうどに一致する 01-05 分も次tickまで待たせず境界に含む
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

    // dtstart から now までは4000日以上あり、上限30件を大きく超える
    const now = new Date("2026-01-01T00:00:00.000Z");
    await processSchedules(now);

    expect(await countTodoTasks(listId)).toBe(30);

    const db = getDb();
    const rows = await db
      .select({ last_fired: schedules.last_fired })
      .from(schedules)
      .where(eq(schedules.id, scheduleId))
      .limit(1);
    // last_fired は生成済み30件目ではなく、now 以前の実際の最終発火予定まで進む。
    // DTSTART;TZID=Asia/Tokyo:20000101T090000 は 2000-01-01T00:00:00.000Z に相当し、
    // 以後24時間ごとの発火予定は常に日付境界（00:00:00.000Z）に一致する。
    // now=2026-01-01T00:00:00.000Z 自体が発火予定と一致するため、
    // rule.before(now, true) は now 自身を返す
    expect(rows[0]!.last_fired?.toISOString()).toBe("2026-01-01T00:00:00.000Z");
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

    // UNTIL は RFC5545 の規定に従い UTC 形式（末尾 Z 付き）で保存する
    const rrule =
      "DTSTART;TZID=Asia/Tokyo:20260201T090000\n" +
      "RRULE:FREQ=DAILY;INTERVAL=1;UNTIL=20260203T090000Z";
    await insertSchedule({
      listId,
      rrule,
      created: new Date("2026-01-31T00:00:00.000Z"),
    });

    // UNTIL より大幅に未来の now を渡しても、UNTIL 以降の発火予定は生成されない
    await processSchedules(new Date("2026-03-01T00:00:00.000Z"));

    // 02-01, 02-02, 02-03 の3回分のみ（UNTIL は境界を含む）
    expect(await countTodoTasks(listId)).toBe(3);
  });

  it("1件のrrule不正で例外が起きても、他の正常スケジュールの発火は継続する", async () => {
    const { userId, listId } = await createFixtureList();
    createdUserIds.push(userId);

    // Zodバリデーション（rrulestrによる構文検証）を経ないDB直接投入を想定し、
    // rrulestrが例外を投げる不正な文字列を1件混在させる
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

    // 不正スケジュール分は生成されず、正常スケジュール分の5回だけが生成される
    expect(await countTodoTasks(listId)).toBe(5);
  });
});
