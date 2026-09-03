/**
 * @fileoverview カロリー計算APIの統合テスト
 */

import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { getDb } from "../db";
import { calorieItems, calorieRecords, users } from "../schema";
import {
  createCalorieItem,
  createCalorieRecord,
  getAllCalorieRecords,
  getCalorieItems,
  getCalorieRecords,
  getCalorieSummary,
  importCalorieRecords,
  updateCalorieItem,
} from "./calories";

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

const BASE_TIME_MS = new Date("2026-09-01T12:00:00.000Z").getTime();
const HOUR_MS = 60 * 60 * 1000;

type SummaryRow = { consumed_at: Date; quantity: number; kcal: number };

/** 与えた記録だけを対象に集計する（DBと利用者設定はモックする） */
async function summarizeRows(rows: SummaryRow[], goalKcal = 1615) {
  vi.resetModules();
  vi.doMock("../db", () => ({
    getDb: () => ({
      select: () => ({
        from: () => ({
          innerJoin: () => ({ where: () => Promise.resolve(rows) }),
        }),
      }),
    }),
  }));
  vi.doMock("./users", () => ({
    getUserPreferences: () => Promise.resolve({ calorie_goal_kcal: goalKcal }),
  }));

  try {
    const { getCalorieSummary: getSummary } = await import("./calories");
    return await getSummary(1, new Date(BASE_TIME_MS));
  } finally {
    vi.doUnmock("../db");
    vi.doUnmock("./users");
    vi.resetModules();
  }
}

/** 経過時間とkcalで指定した記録1件を返す */
function makeRow(elapsedHours: number, kcal = 100): SummaryRow {
  return {
    consumed_at: new Date(BASE_TIME_MS - elapsedHours * HOUR_MS),
    quantity: 1,
    kcal,
  };
}

/** 1日1500kcalを8時間間隔で3等分し、28日間続けた状態の記録 */
function steadyRows(): SummaryRow[] {
  return Array.from({ length: 84 }, (_, index) => makeRow(4 + index * 8, 500));
}

it("ペースは経過時間に応じた重みで数え、平均は期間の合計を日数で割る", async () => {
  const summary = await summarizeRows([0, 24, 48].map((h) => makeRow(h)));

  // ペースは重み1・e^-1・e^-2の合計150kcal、平均は3件の合計300kcalを日数で割った値
  expect(summary.periods).toEqual([
    { days: 1, daily_kcal: 150, percentage: 9.3 },
    { days: 7, daily_kcal: 43, percentage: 2.7 },
    { days: 28, daily_kcal: 11, percentage: 0.7 },
  ]);
});

it("7日間平均と28日間平均は期間の内側の記録だけを数える", async () => {
  const summary = await summarizeRows(
    [7 * 24 - 1, 7 * 24 + 1].map((h) => makeRow(h)),
  );

  // 7日間平均は7日以内の1件だけ、28日間平均は2件とも数える
  expect(summary.periods.map((period) => period.daily_kcal)).toEqual([
    0, 14, 7,
  ]);
});

it("目標どおりに食べ続けるとペースも平均も目標値と一致する", async () => {
  const summary = await summarizeRows(steadyRows(), 1500);

  // ペースは等比級数の和500×e^(-1/6)÷(1-e^(-1/3))=1493kcal
  expect(summary.periods).toEqual([
    { days: 1, daily_kcal: 1493, percentage: 99.5 },
    { days: 7, daily_kcal: 1500, percentage: 100 },
    { days: 28, daily_kcal: 1500, percentage: 100 },
  ]);
});

it("摂取した分だけペースが増える", async () => {
  const rows = steadyRows();

  const before = await summarizeRows(rows, 1500);
  const after = await summarizeRows([makeRow(0, 500), ...rows], 1500);

  expect(after.periods[0].daily_kcal - before.periods[0].daily_kcal).toBe(500);
});

it("一定の速さで摂取し続けるとペースが1日当たり摂取量へ収束する", async () => {
  const intervalMinutes = 6;
  const kcalPerRecord = 100;
  const rows = Array.from(
    { length: (14 * 24 * 60) / intervalMinutes },
    (_, index) => makeRow((index * intervalMinutes) / 60, kcalPerRecord),
  );

  const summary = await summarizeRows(rows);

  const hourlyKcal = (kcalPerRecord * 60) / intervalMinutes;
  const expected = hourlyKcal * 24;
  const actual = summary.periods[0].daily_kcal;
  expect(Math.abs(actual - expected) / expected).toBeLessThanOrEqual(0.005);
});

async function createFixtureUser(): Promise<number> {
  const [{ id }] = await getDb()
    .insert(users)
    .values({
      user: `cal${Math.random().toString(36).slice(2, 13)}`,
      pass_hash: "dummy",
      joined: new Date(),
    })
    .$returningId();
  return id;
}

describeDb("カロリー計算API", () => {
  const userIds: number[] = [];

  afterAll(async () => {
    if (userIds.length === 0) return;
    await getDb()
      .delete(calorieRecords)
      .where(inArray(calorieRecords.user_id, userIds));
    await getDb()
      .delete(calorieItems)
      .where(inArray(calorieItems.user_id, userIds));
    await getDb().delete(users).where(inArray(users.id, userIds));
  });

  it("品目名変更後も記録が同じ品目を参照する", async () => {
    const userId = await createFixtureUser();
    userIds.push(userId);
    await createCalorieItem(userId, { name: "旧名称", kcal: 100, note: "" });
    const [item] = await getCalorieItems(userId);
    await createCalorieRecord(userId, {
      consumed_at: "2026/09/01 12:00",
      item_id: item.id,
      quantity: 2,
      tz_offset_minutes: 0,
    });

    await updateCalorieItem(userId, {
      itemId: item.id,
      name: "新名称",
      kcal: 125,
      note: "変更済み",
    });

    expect(await getAllCalorieRecords(userId)).toMatchObject([
      { item_id: item.id, item_name: "新名称", total_kcal: 250 },
    ]);
  });

  it("30日窓を端点込みで分割し、全記録取得は窓外も含める", async () => {
    const userId = await createFixtureUser();
    userIds.push(userId);
    await createCalorieItem(userId, { name: "食品", kcal: 10, note: "" });
    const [item] = await getCalorieItems(userId);
    for (const consumed_at of [
      "2026/09/01 00:00",
      "2026/08/03 00:00",
      "2026/08/02 23:59",
    ]) {
      await createCalorieRecord(userId, {
        consumed_at,
        item_id: item.id,
        quantity: 1,
        tz_offset_minutes: 0,
      });
    }

    const first = await getCalorieRecords(
      userId,
      { window_offset: 0, tz_offset_minutes: 0 },
      new Date("2026-09-01T12:00:00.000Z"),
    );
    const previous = await getCalorieRecords(
      userId,
      { window_offset: 1, tz_offset_minutes: 0 },
      new Date("2026-09-01T12:00:00.000Z"),
    );
    expect(first.records.map((record) => record.consumed_at)).toEqual([
      "2026-09-01T00:00:00.000Z",
      "2026-08-03T00:00:00.000Z",
    ]);
    expect(previous.records.map((record) => record.consumed_at)).toEqual([
      "2026-08-02T23:59:00.000Z",
    ]);
    expect(await getAllCalorieRecords(userId)).toHaveLength(3);
  });

  it("期間の境界ちょうどの記録を平均へ含める", async () => {
    const userId = await createFixtureUser();
    userIds.push(userId);
    await createCalorieItem(userId, { name: "食品", kcal: 100, note: "" });
    const [item] = await getCalorieItems(userId);
    for (const consumed_at of [
      "2026/08/31 12:00",
      "2026/08/25 12:00",
      "2026/08/04 12:00",
    ]) {
      await createCalorieRecord(userId, {
        consumed_at,
        item_id: item.id,
        quantity: 1,
        tz_offset_minutes: 0,
      });
    }

    const summary = await getCalorieSummary(
      userId,
      new Date("2026-09-01T12:00:00.000Z"),
    );
    expect(summary.goal_kcal).toBe(1615);
    // ペースは1日前の記録がe^-1、7日前と28日前の記録がそれぞれの期間の境界に入る
    expect(summary.periods.map((period) => period.daily_kcal)).toEqual([
      37, 29, 11,
    ]);
  });

  it("未知品目を含む記録CSVは1行も反映しない", async () => {
    const userId = await createFixtureUser();
    userIds.push(userId);
    await createCalorieItem(userId, { name: "既知", kcal: 10, note: "" });

    await expect(
      importCalorieRecords(
        userId,
        [
          {
            consumed_at: "2026/09/01 10:00",
            item_name: "既知",
            quantity: 1,
          },
          {
            consumed_at: "2026/09/01 11:00",
            item_name: "未知",
            quantity: 1,
          },
        ],
        0,
      ),
    ).rejects.toThrow("calorie_csv_unknown_item");
    expect(await getAllCalorieRecords(userId)).toHaveLength(0);
    expect(
      await getDb()
        .select({ id: calorieRecords.id })
        .from(calorieRecords)
        .where(eq(calorieRecords.user_id, userId)),
    ).toHaveLength(0);
  });
});
