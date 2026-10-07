/**
 * @fileoverview 認証関連API（ログイン・ユーザー登録）
 */

import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";

import { getDb } from "../db";
import { users } from "../schema";
import { ApiError } from "../api-errors";

export type UserInfo = {
  id: number;
  user: string;
};

/** ログイン認証。成功時にユーザー情報を返し、失敗時に null を返す。 */
export async function validateCredentials(
  user: string,
  password: string,
): Promise<UserInfo | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.user, user))
    .limit(1);
  if (rows.length === 0) return null;
  const row = rows[0];
  const ok = await bcrypt.compare(password, row.pass_hash);
  if (!ok) return null;
  await db
    .update(users)
    .set({ last_login: new Date() })
    .where(eq(users.id, row.id));
  return { id: row.id, user: row.user };
}

/** 検証済みの利用者情報を登録する。 */
export async function registerUser(
  userId: string,
  password: string,
): Promise<UserInfo> {
  const db = getDb();
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.user, userId))
    .limit(1);
  if (existing.length > 0) {
    throw new ApiError("user_id_conflict");
  }
  const passHash = await bcrypt.hash(password, 10);
  const result = await db
    .insert(users)
    .values({ user: userId, pass_hash: passHash, joined: new Date() });
  return { id: Number(result[0].insertId), user: userId };
}
