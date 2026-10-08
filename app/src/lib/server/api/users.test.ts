/**
 * @fileoverview 利用者設定APIの部分更新テスト
 */

import { eq } from "drizzle-orm";
import { afterAll, expect, it } from "vitest";

import {
  createFixtureUser,
  cleanupFixtures,
  describeDb,
} from "../db-test-helpers";
import { getDb } from "../db";
import { users } from "../schema";
import { getUserPreferences, updateUserPreferences } from "./users";

describeDb("updateUserPreferences", () => {
  const userIds: number[] = [];

  afterAll(async () => {
    await cleanupFixtures(userIds);
  });

  it("タイマー設定とカロリー目標値を相互に保持する", async () => {
    const userId = await createFixtureUser();
    userIds.push(userId);

    await updateUserPreferences(userId, { ringSeconds: 10 });
    await updateUserPreferences(userId, { calorieGoalKcal: 1800 });
    expect(await getUserPreferences(userId)).toEqual({
      ringSeconds: 10,
      calorieGoalKcal: 1800,
    });

    await updateUserPreferences(userId, { adjustMinutes: 5 });
    expect(await getUserPreferences(userId)).toEqual({
      ringSeconds: 10,
      adjustMinutes: 5,
      calorieGoalKcal: 1800,
    });
  });

  it("保存された全設定を読み取り、不正なJSONは空設定として扱う", async () => {
    const userId = await createFixtureUser();
    userIds.push(userId);
    const preferences = {
      mode: "alarm",
      ringSeconds: 10,
      baseSeconds: 300,
      adjustMinutes: 5,
      calorieGoalKcal: 1800,
    };
    await getDb()
      .update(users)
      .set({ preferences: JSON.stringify(preferences) })
      .where(eq(users.id, userId));
    expect(await getUserPreferences(userId)).toEqual(preferences);
    await getDb()
      .update(users)
      .set({ preferences: "{invalid" })
      .where(eq(users.id, userId));
    expect(await getUserPreferences(userId)).toEqual({});
  });
});
