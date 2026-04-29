/**
 * @fileoverview ユーザー関連API（利用者設定の取得・保存）
 */

import { eq } from "drizzle-orm";

import type { UserPreferences } from "$lib/schemas";
import { UserPreferencesSchema } from "$lib/schemas";
import { getDb } from "../db";
import { users } from "../schema";

/**
 * 利用者の新規タイマー作成時の既定値を取得する。
 * 破損データや未保存の利用者には空オブジェクトを返し、欠落フィールドは
 * 呼び出し側のフォールバック定数で補う。
 */
export async function getUserPreferences(
  userId: number,
): Promise<UserPreferences> {
  const db = getDb();
  const rows = await db
    .select({ preferences: users.preferences })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  if (rows.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(rows[0].preferences);
    const result = UserPreferencesSchema.safeParse(parsed);
    return result.success ? result.data : {};
  } catch {
    return {};
  }
}

/** 利用者の既定値を保存する（既存値は完全に置き換える） */
export async function updateUserPreferences(
  userId: number,
  preferences: UserPreferences,
): Promise<void> {
  const db = getDb();
  await db
    .update(users)
    .set({ preferences: JSON.stringify(preferences) })
    .where(eq(users.id, userId));
}
