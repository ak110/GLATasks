/**
 * @fileoverview カロリー計算APIの統合テスト
 */

import { eq } from "drizzle-orm";
import { afterAll, expect, it } from "vitest";

import { processCalorieAutoRecords } from "../calorie-scheduler";
import { getDb } from "../db";
import { calorieRecords } from "../schema";
import {
  bulkCreateCalorieRecords,
  bulkDeleteCalorieRecords,
  createCalorieAutoRecord,
  createCalorieItem,
  createCalorieRecord,
  deleteCalorieAutoRecord,
  deleteCalorieRecord,
  deleteCalorieItem,
  getAllCalorieRecords,
  getCalorieAutoRecords,
  getCalorieItems,
  getCalorieRecords,
  getCalorieSummary,
  importCalorieRecords,
  updateCalorieAutoRecord,
  updateCalorieItem,
  updateCalorieRecord,
} from "./calories";

import {
  createFixtureUser,
  cleanupFixtures,
  describeDb,
} from "../db-test-helpers";

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
    await cleanupFixtures(userIds);
  });

  it("品目名変更後も記録が同じ品目を参照する", async () => {
    const userId = await createFixtureUser();
    userIds.push(userId);
    await createCalorieItem(userId, { name: "旧名称", kcal: 100, note: "" });
    const [item] = await getCalorieItems(userId);
    await createCalorieRecord(userId, {
      consumedAt: "2026/09/01 12:00",
      itemId: item.id,
      quantity: 2,
      tzOffsetMinutes: 0,
    });

    await updateCalorieItem(userId, {
      itemId: item.id,
      name: "新名称",
      kcal: 125,
      note: "変更済み",
    });

    expect(await getAllCalorieRecords(userId)).toMatchObject([
      { itemId: item.id, itemName: "新名称", totalKcal: 250 },
    ]);
  });

  it("一時項目は品目と掛け算せず、同名の品目を後から作成しても一時項目のまま一覧と集計へ含める", async () => {
    const userId = await createFixtureUser();
    userIds.push(userId);
    await createCalorieRecord(userId, {
      consumedAt: "2026/08/31 12:00",
      temporaryName: "外食",
      quantity: 850,
      tzOffsetMinutes: 0,
    });
    const item = await createFixtureItem(userId, "外食");
    await createCalorieRecord(userId, {
      consumedAt: "2026/08/31 18:00",
      itemId: item.id,
      quantity: 2,
      tzOffsetMinutes: 0,
    });

    expect(await getAllCalorieRecords(userId)).toMatchObject([
      {
        itemId: item.id,
        itemName: "外食",
        totalKcal: 200,
        temporary: false,
      },
      {
        itemId: null,
        itemName: "外食",
        itemKcal: null,
        quantity: 850,
        totalKcal: 850,
        temporary: true,
      },
    ]);
    const summary = await getCalorieSummary(
      userId,
      0,
      new Date("2026-09-01T12:00:00.000Z"),
    );
    // ペースは850×e^-1+200×e^-0.75、7日間平均は1050kcalを7日、28日間平均は28日で割った値
    expect(summary.periods.map((period) => period.dailyKcal)).toEqual([
      407, 150, 38,
    ]);

    const [converted] = await getAllCalorieRecords(userId);
    await updateCalorieRecord(userId, {
      recordId: converted.id,
      consumedAt: "2026/08/31 18:00",
      temporaryName: "外食",
      quantity: 200,
      tzOffsetMinutes: 0,
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
      { itemId: null, totalKcal: 200, temporary: true },
      { itemId: null, totalKcal: 850, temporary: true },
      { itemName: "未登録の間食", totalKcal: 300, temporary: true },
    ]);
  });

  it("同名の品目の追加と同名への変更を名前の重複として拒否する", async () => {
    const userId = await createFixtureUser();
    userIds.push(userId);
    await createCalorieItem(userId, { name: "既存", kcal: 100, note: "" });
    const other = await createFixtureItem(userId, "別名");

    await expect(
      createCalorieItem(userId, { name: "既存", kcal: 1, note: "" }),
    ).rejects.toThrow("calorie_item_name_conflict");
    await expect(
      updateCalorieItem(userId, {
        itemId: other.id,
        name: "既存",
        kcal: 1,
        note: "",
      }),
    ).rejects.toThrow("calorie_item_name_conflict");
  });

  it("30日窓を端点込みで分割し、全記録取得は窓外も含める", async () => {
    const userId = await createFixtureUser();
    userIds.push(userId);
    await createCalorieItem(userId, { name: "食品", kcal: 10, note: "" });
    const [item] = await getCalorieItems(userId);
    for (const consumedAt of [
      "2026/09/01 00:00",
      "2026/08/03 00:00",
      "2026/08/02 23:59",
    ]) {
      await createCalorieRecord(userId, {
        consumedAt,
        itemId: item.id,
        quantity: 1,
        tzOffsetMinutes: 0,
      });
    }

    const first = await getCalorieRecords(
      userId,
      { windowOffset: 0, tzOffsetMinutes: 0 },
      new Date("2026-09-01T12:00:00.000Z"),
    );
    const previous = await getCalorieRecords(
      userId,
      { windowOffset: 1, tzOffsetMinutes: 0 },
      new Date("2026-09-01T12:00:00.000Z"),
    );
    expect(first.records.map((record) => record.consumedAt)).toEqual([
      "2026-09-01T00:00:00.000Z",
      "2026-08-03T00:00:00.000Z",
    ]);
    expect(previous.records.map((record) => record.consumedAt)).toEqual([
      "2026-08-02T23:59:00.000Z",
    ]);
    expect(await getAllCalorieRecords(userId)).toHaveLength(3);
  });

  it("期間の境界ちょうどの記録を平均へ含める", async () => {
    const userId = await createFixtureUser();
    userIds.push(userId);
    await createCalorieItem(userId, { name: "食品", kcal: 100, note: "" });
    const [item] = await getCalorieItems(userId);
    for (const consumedAt of [
      "2026/08/31 12:00",
      "2026/08/25 12:00",
      "2026/08/04 12:00",
    ]) {
      await createCalorieRecord(userId, {
        consumedAt,
        itemId: item.id,
        quantity: 1,
        tzOffsetMinutes: 0,
      });
    }

    const summary = await getCalorieSummary(
      userId,
      0,
      new Date("2026-09-01T12:00:00.000Z"),
    );
    expect(summary.goalKcal).toBe(1615);
    // ペースは1日前の記録がe^-1、7日前と28日前の記録がそれぞれの期間の境界に入る
    expect(summary.periods.map((period) => period.dailyKcal)).toEqual([
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
      startDate: "2026/09/01",
      endDate: "2026/09/03",
      timeOfDay: "07:30",
      itemId: item.id,
      quantity: 2,
      tzOffsetMinutes: 540,
    };

    expect(await bulkCreateCalorieRecords(userId, input)).toEqual({
      added: 3,
    });
    expect(
      (await getAllCalorieRecords(userId)).map((record) => [
        record.consumedAt,
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
        startDate: "2026/09/03",
        endDate: "2026/09/02",
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
    const record = (itemId: number, consumedAt: string) => ({
      consumedAt,
      itemId,
      quantity: 1,
      tzOffsetMinutes: 540,
    });
    for (const consumedAt of [
      "2026/08/31 23:59",
      "2026/09/01 00:00",
      "2026/09/03 23:59",
      "2026/09/04 00:00",
    ]) {
      await createCalorieRecord(userId, record(target.id, consumedAt));
    }
    await createCalorieRecord(userId, record(other.id, "2026/09/02 12:00"));
    await createCalorieRecord(
      otherUserId,
      record(otherUsersItem.id, "2026/09/02 12:00"),
    );

    expect(
      await bulkDeleteCalorieRecords(userId, {
        startDate: "2026/09/01",
        endDate: "2026/09/03",
        itemId: target.id,
        tzOffsetMinutes: 540,
      }),
    ).toEqual({ deleted: 2 });
    expect(
      (await getAllCalorieRecords(userId)).map((row) => [
        row.itemName,
        row.consumedAt,
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
        timeOfDay: "08:00",
        itemId: item.id,
        quantity: 2,
        enabled: true,
        tzOffsetMinutes: 540,
      },
      new Date("2026-08-01T00:00:00.000Z"),
    );
    const [autoRecord] = await getCalorieAutoRecords(userId);
    expect(autoRecord).toMatchObject({
      timeOfDay: "08:00",
      itemName: "牛乳",
      quantity: 2,
      enabled: true,
    });
    const consumedAts = async () =>
      (await getAllCalorieRecords(userId)).map((row) => row.consumedAt).sort();

    await processCalorieAutoRecords(new Date("2026-08-01T22:59:00.000Z"));
    expect(await consumedAts()).toEqual([]);

    const firstRun = new Date("2026-08-01T23:00:00.000Z");
    expect((await processCalorieAutoRecords(firstRun)).userIds).toContain(
      userId,
    );
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
          timeOfDay: "08:00",
          itemId: item.id,
          quantity: 2,
          enabled,
          tzOffsetMinutes: 540,
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

  it("記録と自動記録のどちらからも使われていない自分の品目だけを削除できる", async () => {
    const userId = await createFixtureUser();
    const otherUserId = await createFixtureUser();
    userIds.push(userId, otherUserId);
    const unused = await createFixtureItem(userId, "未使用");
    const usedByRecord = await createFixtureItem(userId, "記録で使用");
    const usedByAutoRecord = await createFixtureItem(userId, "自動記録で使用");
    const otherUsersItem = await createFixtureItem(otherUserId, "他人の品目");
    await createCalorieRecord(userId, {
      consumedAt: "2026/09/01 12:00",
      itemId: usedByRecord.id,
      quantity: 1,
      tzOffsetMinutes: 540,
    });
    await createCalorieAutoRecord(userId, {
      timeOfDay: "08:00",
      itemId: usedByAutoRecord.id,
      quantity: 1,
      enabled: true,
      tzOffsetMinutes: 540,
    });

    await deleteCalorieItem(userId, unused.id);
    for (const item of [usedByRecord, usedByAutoRecord]) {
      await expect(deleteCalorieItem(userId, item.id)).rejects.toThrow(
        "calorie_item_in_use",
      );
    }
    await deleteCalorieItem(userId, otherUsersItem.id);
    await deleteCalorieItem(userId, unused.id);
    expect((await getCalorieItems(userId)).map((item) => item.name)).toEqual(
      expect.arrayContaining(["記録で使用", "自動記録で使用"]),
    );
    expect(await getCalorieItems(userId)).toHaveLength(2);
    expect(await getCalorieItems(otherUserId)).toHaveLength(1);
  });

  it("他の利用者の品目と自動記録設定を操作できない", async () => {
    const userId = await createFixtureUser();
    const otherUserId = await createFixtureUser();
    userIds.push(userId, otherUserId);
    const otherUsersItem = await createFixtureItem(otherUserId, "他人の品目");
    const input = {
      timeOfDay: "08:00",
      itemId: otherUsersItem.id,
      quantity: 1,
      enabled: true,
      tzOffsetMinutes: 540,
    };
    await expect(createCalorieAutoRecord(userId, input)).rejects.toThrow(
      "calorie_item_not_found",
    );
    await expect(
      bulkDeleteCalorieRecords(userId, {
        startDate: "2026/09/01",
        endDate: "2026/09/01",
        itemId: otherUsersItem.id,
        tzOffsetMinutes: 540,
      }),
    ).rejects.toThrow("calorie_item_not_found");

    await createCalorieAutoRecord(otherUserId, input);
    const [otherUsersRule] = await getCalorieAutoRecords(otherUserId);
    const ownItem = await createFixtureItem(userId, "自分の品目");
    await expect(
      updateCalorieAutoRecord(userId, {
        ...input,
        itemId: ownItem.id,
        autoRecordId: otherUsersRule.id,
      }),
    ).rejects.toThrow("calorie_auto_record_not_found");
    await deleteCalorieAutoRecord(userId, otherUsersRule.id);
    expect(await getCalorieAutoRecords(otherUserId)).toHaveLength(1);
  });

  it("品目の件数は全期間の記録と無効な自動記録も数え、他人の削除要求は何も変えない", async () => {
    const userId = await createFixtureUser();
    const otherUserId = await createFixtureUser();
    userIds.push(userId, otherUserId);
    const used = await createFixtureItem(userId, "使用品目");
    const unused = await createFixtureItem(userId, "未使用品目");
    for (const consumedAt of ["2025/01/01 12:00", "2026/09/01 12:00"]) {
      await createCalorieRecord(userId, {
        consumedAt,
        itemId: used.id,
        quantity: 1,
        tzOffsetMinutes: 0,
      });
    }
    await createCalorieRecord(userId, {
      consumedAt: "2026/09/01 13:00",
      temporaryName: "使用品目",
      quantity: 100,
      tzOffsetMinutes: 0,
    });
    await createCalorieAutoRecord(userId, {
      itemId: used.id,
      timeOfDay: "08:00",
      quantity: 1,
      enabled: false,
      tzOffsetMinutes: 0,
    });
    const counts = () => getCalorieItems(userId);
    expect(await counts()).toEqual(
      expect.arrayContaining([
        { ...used, recordCount: 2, autoRecordCount: 1 },
        { ...unused, recordCount: 0, autoRecordCount: 0 },
      ]),
    );
    const records = await getAllCalorieRecords(userId);
    const [rule] = await getCalorieAutoRecords(userId);
    await deleteCalorieRecord(otherUserId, records[0].id);
    await deleteCalorieAutoRecord(otherUserId, rule.id);
    for (const missingId of [-1, 0]) {
      await deleteCalorieRecord(userId, missingId);
      await deleteCalorieAutoRecord(userId, missingId);
    }
    expect(await getAllCalorieRecords(userId)).toEqual(records);
    expect(await getCalorieAutoRecords(userId)).toEqual([rule]);
    const regular = records.find((row) => !row.temporary)!;
    await deleteCalorieRecord(userId, regular.id);
    await deleteCalorieRecord(userId, regular.id);
    await deleteCalorieAutoRecord(userId, rule.id);
    await deleteCalorieAutoRecord(userId, rule.id);
    expect((await counts()).find((item) => item.id === used.id)).toMatchObject({
      recordCount: 1,
      autoRecordCount: 0,
    });
  });
});
