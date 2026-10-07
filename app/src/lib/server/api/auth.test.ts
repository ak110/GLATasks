import { randomUUID } from "node:crypto";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { afterAll, expect, it } from "vitest";
import { cleanupFixtures, describeDb } from "../db-test-helpers";
import { getDb } from "../db";
import { users } from "../schema";
import { registerUser, validateCredentials } from "./auth";

describeDb("利用者の登録と認証", () => {
  const userIds: number[] = [];
  afterAll(async () => cleanupFixtures(userIds));
  it("パスワードをhashで保存し、誤った認証では最終ログインを更新せず、正しい認証だけ成功する", async () => {
    const name = `auth${randomUUID().replaceAll("-", "").slice(0, 24)}`;
    const password = "試験用のpassword";
    const registered = await registerUser(name, password);
    userIds.push(registered.id);
    const [saved] = await getDb()
      .select()
      .from(users)
      .where(eq(users.id, registered.id));
    expect(saved.pass_hash).not.toBe(password);
    expect(await bcrypt.compare(password, saved.pass_hash)).toBe(true);
    await expect(registerUser(name, password)).rejects.toThrow();
    expect(await validateCredentials(name, "誤ったpassword")).toBeNull();
    expect(await validateCredentials(`${name}x`, password)).toBeNull();
    expect(
      (await getDb().select().from(users).where(eq(users.id, registered.id)))[0]
        .last_login,
    ).toBeNull();
    expect(await validateCredentials(name, password)).toEqual(registered);
    expect(
      (await getDb().select().from(users).where(eq(users.id, registered.id)))[0]
        .last_login,
    ).toBeInstanceOf(Date);
  });
});
