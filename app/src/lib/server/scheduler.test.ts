/**
 * @fileoverview 定期TODOスケジューラー（`processSchedules`）の発火・フィルフォワード・
 * 重複防止ロジックのテスト。
 *
 * 開発用MariaDBへ実接続して検証する（`DATABASE_URL`が到達可能な環境で実行する）。
 * `now` を明示的に引数として渡し、実時刻に依存しないテストとする。
 * 発火予定の計算はプロセスの時刻帯に依存しないため、`make test-db`は本番と同じ`TZ=Asia/Tokyo`でも実行する。
 */

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

/** スケジュールの`last_fired`をISO8601文字列で取得する。 */
async function getLastFired(scheduleId: number): Promise<string | undefined> {
  const rows = await getDb()
    .select({ last_fired: schedules.last_fired })
    .from(schedules)
    .where(eq(schedules.id, scheduleId))
    .limit(1);
  return rows[0]?.last_fired?.toISOString();
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

  it("時刻帯の変換前に9時間遅れで記録されたlast_firedから、重複も欠落もなく生成する", async () => {
    const { userId, listId } = await createFixtureList();
    createdUserIds.push(userId);

    // 変換前の実装を本番の時刻帯（Asia/Tokyo）で動かすと、日本時間9:00の予定のlast_firedは
    // 日本時間18:00（T09:00Z）で記録されていた。
    // 日付は先行する試験の予定のlast_firedより前にし、それらの予定を処理させない
    const rrule =
      "DTSTART;TZID=Asia/Tokyo:20251201T090000\nRRULE:FREQ=DAILY;INTERVAL=1";
    const scheduleId = await insertSchedule({
      listId,
      rrule,
      created: new Date("2025-12-01T00:00:00.000Z"),
      lastFired: new Date("2025-12-04T09:00:00.000Z"),
    });

    // 12-04分は生成済みのため再生成せず、12-05と12-06の日本時間9:00（T00:00Z）の2回分を生成する
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

      // 日付は先行する試験の予定のlast_firedより前にし、それらの予定を処理させない
      await processSchedules(new Date(now));
      expect(await countTodoTasks(listId)).toBe(expectedCount);
      expect(await getLastFired(scheduleId)).toBe(expectedLastFired);
    },
  );

  it("1件のrrule不正で例外が起きても、他の正常スケジュールの発火は継続する", async () => {
    const { userId, listId } = await createFixtureList();
    createdUserIds.push(userId);

    // Zodバリデーション（rrulestrによる構文検証）を経ないDB直接投入を想定し、
    // rrulestrが例外を送出する不正な文字列を1件混在させる
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
