/**
 * @fileoverview カロリー計算APIの統合テスト
 */

import { eq, inArray } from "drizzle-orm";
import { afterAll, describe, expect, it, vi } from "vitest";

import { getDb } from "../db";
import {
  calorieAutoRecords,
  calorieItems,
  calorieRecords,
  users,
} from "../schema";
import {
  bulkCreateCalorieRecords,
  bulkDeleteCalorieRecords,
  createCalorieAutoRecord,
  createCalorieItem,
  createCalorieRecord,
  deleteCalorieAutoRecord,
  getAllCalorieRecords,
  getCalorieAutoRecords,
  getCalorieItems,
  getCalorieRecords,
  getCalorieSummary,
  importCalorieRecords,
  processCalorieAutoRecords,
  updateCalorieAutoRecord,
  updateCalorieItem,
  updateCalorieRecord,
} from "./calories";

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

const BASE_TIME_MS = new Date("2026-09-01T12:00:00.000Z").getTime();
const HOUR_MS = 60 * 60 * 1000;

/** 集計が取得する記録1件（品目の記録。一時項目の集計はDBを使うテストで確かめる） */
type SummaryRow = {
  consumed_at: Date;
  quantity: number;
  item_kcal: number | null;
  temporary_name: string | null;
};

/**
 * 与えた記録だけを対象に集計する（DBと利用者設定はモックする）
 *
 * 最初の記録日時は省略時に与えた記録の最も古い日時とする。
 */
async function summarizeRows(
  rows: SummaryRow[],
  goalKcal = 1615,
  options: { tzOffsetMinutes?: number; firstRecordAt?: Date } = {},
) {
  const firstRecordAt =
    options.firstRecordAt ??
    [...rows.map((row) => row.consumed_at)].sort(
      (a, b) => a.getTime() - b.getTime(),
    )[0];
  vi.resetModules();
  vi.doMock("../db", () => ({
    getDb: () => ({
      select: () => ({
        from: () => ({
          leftJoin: () => ({ where: () => Promise.resolve(rows) }),
          where: () => ({
            orderBy: () => ({
              limit: () =>
                Promise.resolve(
                  firstRecordAt ? [{ consumed_at: firstRecordAt }] : [],
                ),
            }),
          }),
        }),
      }),
    }),
  }));
  vi.doMock("./users", () => ({
    getUserPreferences: () => Promise.resolve({ calorie_goal_kcal: goalKcal }),
  }));

  try {
    const { getCalorieSummary: getSummary } = await import("./calories");
    return await getSummary(
      1,
      options.tzOffsetMinutes ?? 0,
      new Date(BASE_TIME_MS),
    );
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
    item_kcal: kcal,
    temporary_name: null,
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

describe("達成状況", () => {
  // 時差0では2026-09-01T04:00Zが当日の開始で、それより前が確定日となる
  const TODAY_START_MS = new Date("2026-09-01T04:00:00.000Z").getTime();
  const LONG_AGO = new Date(TODAY_START_MS - 60 * 24 * HOUR_MS);

  /** 指定した日数前の確定日の正午（UTC）に摂取した記録を返す */
  function dayRow(daysAgo: number, kcal: number): SummaryRow {
    return {
      consumed_at: new Date(
        TODAY_START_MS - daysAgo * 24 * HOUR_MS + 8 * HOUR_MS,
      ),
      quantity: 1,
      item_kcal: kcal,
      temporary_name: null,
    };
  }

  function daysRows(from: number, to: number, kcal: number): SummaryRow[] {
    return Array.from({ length: to - from + 1 }, (_, index) =>
      dayRow(from + index, kcal),
    );
  }

  it("直近28確定日を古い順に並べ、当日を含めない", async () => {
    const { achievement } = await summarizeRows([], 1615, {
      firstRecordAt: LONG_AGO,
    });

    expect(achievement.days).toHaveLength(28);
    expect(achievement.days[0].date).toBe("2026/08/04");
    expect(achievement.days[27].date).toBe("2026/08/31");
  });

  it("早朝4時の区切りと端末の時差で記録の日を分ける", async () => {
    const rows: SummaryRow[] = [
      // 時差0では前日の3:59、時差+9時間では当日の12:59
      {
        consumed_at: new Date("2026-09-01T03:59:00.000Z"),
        quantity: 1,
        item_kcal: 700,
        temporary_name: null,
      },
      // 時差0では当日の4:00
      {
        consumed_at: new Date("2026-09-01T04:00:00.000Z"),
        quantity: 1,
        item_kcal: 7000,
        temporary_name: null,
      },
    ];

    const utc = await summarizeRows(rows, 1615, { firstRecordAt: LONG_AGO });
    const jst = await summarizeRows(rows, 1615, {
      firstRecordAt: LONG_AGO,
      tzOffsetMinutes: 540,
    });

    expect(utc.achievement.latest_average_kcal).toBe(100);
    expect(jst.achievement.latest_average_kcal).toBe(0);
    expect(jst.achievement.days[27].date).toBe("2026/08/31");
  });

  it("7日平均が目標と等しい日を達成とし、超えた日で連続日数が止まる", async () => {
    // 昨日の窓（1〜7日前）は平均1000、一昨日の窓（2〜8日前）は平均1001
    const rows = [...daysRows(1, 7, 1000), dayRow(8, 1007)];

    const { achievement } = await summarizeRows(rows, 1000, {
      firstRecordAt: LONG_AGO,
    });

    expect(achievement.days[27]).toEqual({
      date: "2026/08/31",
      average_kcal: 1000,
      status: "achieved",
    });
    expect(achievement.days[26].status).toBe("missed");
    expect(achievement.streak_days).toBe(1);
  });

  it("最初の記録の日より前へかかる窓は判定対象外とする", async () => {
    const rows = daysRows(1, 8, 100);

    const { achievement } = await summarizeRows(rows);

    // 8日前が最初の記録の日なので、1日前と2日前の窓だけが判定できる
    expect(achievement.days.slice(-2).map((day) => day.status)).toEqual([
      "achieved",
      "achieved",
    ]);
    expect(achievement.days[25]).toEqual({
      date: "2026/08/29",
      average_kcal: null,
      status: "unrated",
    });
    expect(achievement.streak_days).toBe(2);
  });

  it("記録が無い利用者はすべて判定対象外とする", async () => {
    const { achievement } = await summarizeRows([]);

    expect(achievement.days.every((day) => day.status === "unrated")).toBe(
      true,
    );
    expect(achievement.streak_days).toBe(0);
    expect(achievement.latest_average_kcal).toBeNull();
    expect(achievement.weekly_change_kcal).toBeNull();
  });

  it("記録の無い日を0kcalとして平均へ含める", async () => {
    // 30日前の記録だけがあり、以降の日は記録が無い
    const { achievement } = await summarizeRows([dayRow(30, 700)]);

    // 24日前の窓（24〜30日前）は平均100、それより新しい窓は平均0で、いずれも達成
    expect(achievement.days[4]).toEqual({
      date: "2026/08/08",
      average_kcal: 100,
      status: "achieved",
    });
    expect(achievement.days[3].status).toBe("unrated");
    expect(achievement.latest_average_kcal).toBe(0);
    expect(achievement.streak_days).toBe(24);
  });

  it("28確定日すべてが達成なら連続日数は28となる", async () => {
    const { achievement } = await summarizeRows([], 1615, {
      firstRecordAt: LONG_AGO,
    });

    expect(achievement.streak_days).toBe(28);
  });

  it("先週比は昨日の7日平均から7日前の7日平均を引いた値とする", async () => {
    const rows = [...daysRows(1, 7, 1000), ...daysRows(8, 14, 1500)];

    const decreased = await summarizeRows(rows);
    const increased = await summarizeRows([
      ...daysRows(1, 7, 1500),
      ...daysRows(8, 14, 1000),
    ]);

    expect(decreased.achievement.latest_average_kcal).toBe(1000);
    expect(decreased.achievement.weekly_change_kcal).toBe(-500);
    expect(increased.achievement.weekly_change_kcal).toBe(500);
  });

  it("7日前の窓が判定対象外なら先週比を算出しない", async () => {
    const { achievement } = await summarizeRows(daysRows(1, 10, 1000));

    expect(achievement.latest_average_kcal).toBe(1000);
    expect(achievement.weekly_change_kcal).toBeNull();
  });
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

/** 品目を1件作成し、作成した品目を返す */
async function createFixtureItem(userId: number, name: string) {
  await createCalorieItem(userId, { name, kcal: 100, note: "" });
  const item = (await getCalorieItems(userId)).find(
    (candidate) => candidate.name === name,
  );
  if (!item) throw new Error("品目を作成できません");
  return item;
}

describeDb("カロリー計算API", () => {
  const userIds: number[] = [];

  afterAll(async () => {
    if (userIds.length === 0) return;
    await getDb()
      .delete(calorieAutoRecords)
      .where(inArray(calorieAutoRecords.user_id, userIds));
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

  it("一時項目は品目と掛け算せず、同名の品目を後から作成しても一時項目のまま一覧と集計へ含める", async () => {
    const userId = await createFixtureUser();
    userIds.push(userId);
    await createCalorieRecord(userId, {
      consumed_at: "2026/08/31 12:00",
      temporary_name: "外食",
      quantity: 850,
      tz_offset_minutes: 0,
    });
    const item = await createFixtureItem(userId, "外食");
    await createCalorieRecord(userId, {
      consumed_at: "2026/08/31 18:00",
      item_id: item.id,
      quantity: 2,
      tz_offset_minutes: 0,
    });

    expect(await getAllCalorieRecords(userId)).toMatchObject([
      {
        item_id: item.id,
        item_name: "外食",
        total_kcal: 200,
        temporary: false,
      },
      {
        item_id: null,
        item_name: "外食",
        item_kcal: null,
        quantity: 850,
        total_kcal: 850,
        temporary: true,
      },
    ]);
    const summary = await getCalorieSummary(
      userId,
      0,
      new Date("2026-09-01T12:00:00.000Z"),
    );
    // ペースは850×e^-1+200×e^-0.75、7日間平均は1050kcalを7日、28日間平均は28日で割った値
    expect(summary.periods.map((period) => period.daily_kcal)).toEqual([
      407, 150, 38,
    ]);

    const [converted] = await getAllCalorieRecords(userId);
    await updateCalorieRecord(userId, {
      recordId: converted.id,
      consumed_at: "2026/08/31 18:00",
      temporary_name: "外食",
      quantity: 200,
      tz_offset_minutes: 0,
    });
    await importCalorieRecords(
      userId,
      [
        {
          consumed_at: "2026/08/30 12:00",
          item_name: "未登録の間食",
          quantity: 300,
          temporary: true,
        },
      ],
      0,
    );
    expect(await getAllCalorieRecords(userId)).toMatchObject([
      { item_id: null, total_kcal: 200, temporary: true },
      { item_id: null, total_kcal: 850, temporary: true },
      { item_name: "未登録の間食", total_kcal: 300, temporary: true },
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
      0,
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
            temporary: false,
          },
          {
            consumed_at: "2026/09/01 11:00",
            item_name: "未知",
            quantity: 1,
            temporary: false,
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

  it("期間の各日の指定時刻へ記録を追加し、逆順の期間では追加しない", async () => {
    const userId = await createFixtureUser();
    userIds.push(userId);
    const item = await createFixtureItem(userId, "朝食");
    const input = {
      start_date: "2026/09/01",
      end_date: "2026/09/03",
      time_of_day: "07:30",
      item_id: item.id,
      quantity: 2,
      tz_offset_minutes: 540,
    };

    expect(await bulkCreateCalorieRecords(userId, input)).toEqual({
      added: 3,
    });
    expect(
      (await getAllCalorieRecords(userId)).map((record) => [
        record.consumed_at,
        record.quantity,
      ]),
    ).toEqual([
      ["2026-09-02T22:30:00.000Z", 2],
      ["2026-09-01T22:30:00.000Z", 2],
      ["2026-08-31T22:30:00.000Z", 2],
    ]);

    // 終了日が開始日より前の指定は1件も追加しない
    expect(
      await bulkCreateCalorieRecords(userId, {
        ...input,
        start_date: "2026/09/03",
        end_date: "2026/09/02",
      }),
    ).toEqual({ added: 0 });
    expect(await getAllCalorieRecords(userId)).toHaveLength(3);
  });

  it("期間内の指定品目の記録だけを一括削除する", async () => {
    const userId = await createFixtureUser();
    const otherUserId = await createFixtureUser();
    userIds.push(userId, otherUserId);
    const target = await createFixtureItem(userId, "対象");
    const other = await createFixtureItem(userId, "別品目");
    const otherUsersItem = await createFixtureItem(otherUserId, "対象");
    const record = (item_id: number, consumed_at: string) => ({
      consumed_at,
      item_id,
      quantity: 1,
      tz_offset_minutes: 540,
    });
    for (const consumed_at of [
      "2026/08/31 23:59",
      "2026/09/01 00:00",
      "2026/09/03 23:59",
      "2026/09/04 00:00",
    ]) {
      await createCalorieRecord(userId, record(target.id, consumed_at));
    }
    await createCalorieRecord(userId, record(other.id, "2026/09/02 12:00"));
    await createCalorieRecord(
      otherUserId,
      record(otherUsersItem.id, "2026/09/02 12:00"),
    );

    expect(
      await bulkDeleteCalorieRecords(userId, {
        start_date: "2026/09/01",
        end_date: "2026/09/03",
        item_id: target.id,
        tz_offset_minutes: 540,
      }),
    ).toEqual({ deleted: 2 });
    expect(
      (await getAllCalorieRecords(userId)).map((row) => [
        row.item_name,
        row.consumed_at,
      ]),
    ).toEqual([
      ["対象", "2026-09-03T15:00:00.000Z"],
      ["別品目", "2026-09-02T03:00:00.000Z"],
      ["対象", "2026-08-31T14:59:00.000Z"],
    ]);
    expect(await getAllCalorieRecords(otherUserId)).toHaveLength(1);
  });

  it("自動記録は過ぎた時刻ごとに1回だけ記録し、OFFの間は記録も遡りもしない", async () => {
    const userId = await createFixtureUser();
    userIds.push(userId);
    const item = await createFixtureItem(userId, "牛乳");
    // 現地（UTC+9）8月1日9時に「毎日8時」を登録すると、初回は8月2日8時（UTC 8月1日23時）になる
    await createCalorieAutoRecord(
      userId,
      {
        time_of_day: "08:00",
        item_id: item.id,
        quantity: 2,
        enabled: true,
        tz_offset_minutes: 540,
      },
      new Date("2026-08-01T00:00:00.000Z"),
    );
    const [autoRecord] = await getCalorieAutoRecords(userId);
    expect(autoRecord).toMatchObject({
      time_of_day: "08:00",
      item_name: "牛乳",
      quantity: 2,
      enabled: true,
    });
    const consumedAts = async () =>
      (await getAllCalorieRecords(userId)).map((row) => row.consumed_at).sort();

    await processCalorieAutoRecords(new Date("2026-08-01T22:59:00.000Z"));
    expect(await consumedAts()).toEqual([]);

    const firstRun = new Date("2026-08-01T23:00:00.000Z");
    expect(await processCalorieAutoRecords(firstRun)).toContain(userId);
    await processCalorieAutoRecords(firstRun);
    expect(await consumedAts()).toEqual(["2026-08-01T23:00:00.000Z"]);

    await processCalorieAutoRecords(new Date("2026-08-04T23:30:00.000Z"));
    expect(await consumedAts()).toEqual([
      "2026-08-01T23:00:00.000Z",
      "2026-08-02T23:00:00.000Z",
      "2026-08-03T23:00:00.000Z",
      "2026-08-04T23:00:00.000Z",
    ]);

    const update = (enabled: boolean, now: string) =>
      updateCalorieAutoRecord(
        userId,
        {
          autoRecordId: autoRecord.id,
          time_of_day: "08:00",
          item_id: item.id,
          quantity: 2,
          enabled,
          tz_offset_minutes: 540,
        },
        new Date(now),
      );
    await update(false, "2026-08-05T00:00:00.000Z");
    await processCalorieAutoRecords(new Date("2026-08-08T00:00:00.000Z"));
    await update(true, "2026-08-08T00:00:00.000Z");
    await processCalorieAutoRecords(new Date("2026-08-08T00:00:00.000Z"));
    expect(await consumedAts()).toHaveLength(4);

    await processCalorieAutoRecords(new Date("2026-08-08T23:00:00.000Z"));
    expect((await consumedAts()).at(-1)).toBe("2026-08-08T23:00:00.000Z");
    expect(await consumedAts()).toHaveLength(5);

    await deleteCalorieAutoRecord(userId, autoRecord.id);
    expect(await getCalorieAutoRecords(userId)).toEqual([]);
  });

  it("他の利用者の品目と自動記録設定を操作できない", async () => {
    const userId = await createFixtureUser();
    const otherUserId = await createFixtureUser();
    userIds.push(userId, otherUserId);
    const otherUsersItem = await createFixtureItem(otherUserId, "他人の品目");
    const input = {
      time_of_day: "08:00",
      item_id: otherUsersItem.id,
      quantity: 1,
      enabled: true,
      tz_offset_minutes: 540,
    };
    await expect(createCalorieAutoRecord(userId, input)).rejects.toThrow(
      "calorie_item_not_found",
    );
    await expect(
      bulkDeleteCalorieRecords(userId, {
        start_date: "2026/09/01",
        end_date: "2026/09/01",
        item_id: otherUsersItem.id,
        tz_offset_minutes: 540,
      }),
    ).rejects.toThrow("calorie_item_not_found");

    await createCalorieAutoRecord(otherUserId, input);
    const [otherUsersRule] = await getCalorieAutoRecords(otherUserId);
    const ownItem = await createFixtureItem(userId, "自分の品目");
    await expect(
      updateCalorieAutoRecord(userId, {
        ...input,
        item_id: ownItem.id,
        autoRecordId: otherUsersRule.id,
      }),
    ).rejects.toThrow("calorie_auto_record_not_found");
    await expect(
      deleteCalorieAutoRecord(userId, otherUsersRule.id),
    ).rejects.toThrow("calorie_auto_record_not_found");
    expect(await getCalorieAutoRecords(otherUserId)).toHaveLength(1);
  });
});
