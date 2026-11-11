import { randomBytes, createHmac } from "node:crypto";
import { and, eq, gt, isNull, lt } from "drizzle-orm";
import { getDb } from "../db";
import { authChallenges, recoveryCodes, users } from "../schema";
import { getEnv } from "../env";
import { getSecret } from "../jwt-key";
import { ApiError } from "../api-errors";

export type AuthTransaction = Parameters<
  Parameters<ReturnType<typeof getDb>["transaction"]>[0]
>[0];
export type AuthUser = typeof users.$inferSelect;
export type Challenge = typeof authChallenges.$inferSelect;
export const randomToken = () => randomBytes(32).toString("base64url");

export function rpConfig() {
  const env = getEnv();
  if (!env.WEBAUTHN_RP_ID || !env.WEBAUTHN_ORIGINS)
    throw new ApiError("passkey_unconfigured");
  return {
    rpID: env.WEBAUTHN_RP_ID,
    expectedOrigin: env.WEBAUTHN_ORIGINS.split(",").map((s) => s.trim()),
  };
}

export async function getSessionGeneration(userId: number) {
  const [row] = await getDb()
    .select({ generation: users.session_generation })
    .from(users)
    .where(eq(users.id, userId));
  return row?.generation;
}

export async function lockUser(tx: AuthTransaction, userId: number) {
  const [user] = await tx
    .select()
    .from(users)
    .where(eq(users.id, userId))
    .for("update");
  if (!user) throw new ApiError("auth_failed");
  return user;
}

export async function saveChallenge(
  values: Omit<typeof authChallenges.$inferInsert, "id" | "expires">,
  db: AuthTransaction | ReturnType<typeof getDb> = getDb(),
) {
  // 終了した試行は期限後に削除する。周期処理を新設せず、次の試行開始時に回収する。
  await db.delete(authChallenges).where(lt(authChallenges.expires, new Date()));
  const id = randomToken();
  await db
    .insert(authChallenges)
    .values({ ...values, id, expires: new Date(Date.now() + 300_000) });
  return id;
}

export async function consumeChallenge(
  tx: AuthTransaction,
  id: string,
  purpose: string,
  userId?: number,
) {
  const condition = and(
    eq(authChallenges.id, id),
    eq(authChallenges.purpose, purpose),
    isNull(authChallenges.consumed),
    gt(authChallenges.expires, new Date()),
    userId === undefined ? undefined : eq(authChallenges.user_id, userId),
  );
  const [result] = await tx
    .update(authChallenges)
    .set({ consumed: new Date() })
    .where(condition);
  if (result.affectedRows !== 1) throw new ApiError("challenge_expired");
  const [row] = await tx
    .select()
    .from(authChallenges)
    .where(eq(authChallenges.id, id));
  return row;
}

export function recoveryDigest(code: string) {
  return createHmac("sha256", getSecret())
    .update(`recovery:${code}`)
    .digest("hex");
}

export async function replaceRecoveryCodes(
  tx: AuthTransaction,
  userId: number,
) {
  const codes = Array.from({ length: 10 }, () =>
    randomBytes(16).toString("hex"),
  );
  await storeRecoveryDigests(tx, userId, codes.map(recoveryDigest));
  return codes;
}

export async function storeRecoveryDigests(
  tx: AuthTransaction,
  userId: number,
  digests: string[],
) {
  await tx.delete(recoveryCodes).where(eq(recoveryCodes.user_id, userId));
  await tx.insert(recoveryCodes).values(
    digests.map((digest) => ({
      user_id: userId,
      digest,
      created: new Date(),
    })),
  );
}
