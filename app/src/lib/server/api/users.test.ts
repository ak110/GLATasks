/**
 * @fileoverview 利用者設定APIの部分更新テスト
 */

import { eq } from "drizzle-orm";
import { afterAll, describe, expect, it } from "vitest";

import { getDb } from "../db";
import { users } from "../schema";
import { getUserPreferences, updateUserPreferences } from "./users";

const describeDb = process.env.DATABASE_URL ? describe : describe.skip;

describeDb("updateUserPreferences", () => {
  const userIds: number[] = [];

  afterAll(async () => {
    if (userIds.length === 0) return;
    for (const userId of userIds) {
      await getDb().delete(users).where(eq(users.id, userId));
    }
  });

  it("タイマー設定とカロリー目標値を相互に保持する", async () => {
    const [{ id: userId }] = await getDb()
      .insert(users)
      .values({
        user: `prefs${Math.random().toString(36).slice(2, 12)}`,
        pass_hash: "dummy",
        joined: new Date(),
      })
      .$returningId();
    userIds.push(userId);

    await updateUserPreferences(userId, { ring_seconds: 10 });
    await updateUserPreferences(userId, { calorie_goal_kcal: 1800 });
    expect(await getUserPreferences(userId)).toEqual({
      ring_seconds: 10,
      calorie_goal_kcal: 1800,
    });

    await updateUserPreferences(userId, { adjust_minutes: 5 });
    expect(await getUserPreferences(userId)).toEqual({
      ring_seconds: 10,
      adjust_minutes: 5,
      calorie_goal_kcal: 1800,
    });
  });
});
