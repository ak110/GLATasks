import bcrypt from "bcryptjs";
import { and, eq } from "drizzle-orm";
import type { Cookies } from "@sveltejs/kit";
import type { z } from "zod";
import type {
  ManageSecuritySchema,
  AuthProofSchema,
} from "#lib/passkey-schemas.ts";
import { getDb } from "../db";
import { passkeys, users } from "../schema";
import { ApiError } from "../api-errors";
import {
  consumeChallenge,
  lockUser,
  randomToken,
  recoveryDigest,
  replaceRecoveryCodes,
  saveChallenge,
  storeRecoveryDigests,
} from "./passkey-common";
import type { AuthTransaction, AuthUser } from "./passkey-common";
import {
  authenticate,
  beginRegistration,
  insertPasskey,
  verifiedRegistration,
} from "./passkey-webauthn";
import { getAttempt, setAttempt } from "../passkey-cookies";

export async function listSecurity(userId: number) {
  const [user] = await getDb().select().from(users).where(eq(users.id, userId));
  if (!user) throw new ApiError("auth_failed");
  const keys = await getDb()
    .select()
    .from(passkeys)
    .where(eq(passkeys.user_id, userId));
  return {
    passwordEnabled: user.pass_hash !== null,
    passkeys: keys.map((key) => ({
      id: key.id,
      name: key.name,
      created: key.created.toISOString(),
      lastUsed: key.last_used?.toISOString() ?? null,
    })),
  };
}

async function reauthenticate(
  tx: AuthTransaction,
  user: AuthUser,
  cookies: Cookies,
  proof: z.infer<typeof AuthProofSchema>,
  passkeyOnly = false,
) {
  if ("password" in proof) {
    if (
      passkeyOnly ||
      !user.pass_hash ||
      !(await bcrypt.compare(proof.password, user.pass_hash))
    )
      throw new ApiError("auth_failed");
    return;
  }
  await authenticate(tx, getAttempt(cookies, "reauth"), proof.response, user);
}

export async function manageSecurity(
  userId: number,
  cookies: Cookies,
  input: z.infer<typeof ManageSecuritySchema>,
) {
  // 利用者行を共通の排他単位とし、最後の認証手段の同時削除と復旧の競合を防ぐ。
  return getDb().transaction(
    async (tx) => {
      const user = await lockUser(tx, userId);
      if (input.action === "rename") {
        await tx
          .update(passkeys)
          .set({ name: input.name })
          .where(and(eq(passkeys.id, input.id), eq(passkeys.user_id, userId)));
        return { success: true };
      }
      if (input.action === "finishAdd") {
        const challenge = await consumeChallenge(
          tx,
          getAttempt(cookies, "add"),
          "add",
          userId,
        );
        if (challenge.generation !== user.session_generation)
          throw new ApiError("auth_failed");
        const credential = await verifiedRegistration(
          challenge,
          input.response,
        );
        // 同時に始めた最初の追加でも、先に確定したuser handleを上書きしない。
        if (user.webauthn_handle && user.webauthn_handle !== challenge.handle)
          throw new ApiError("challenge_expired");
        await tx
          .update(users)
          .set({ webauthn_handle: challenge.handle })
          .where(eq(users.id, userId));
        await insertPasskey(tx, userId, credential, input.name);
        return { success: true };
      }
      if (input.action === "confirmDisable") {
        if (input.attemptId !== getAttempt(cookies, "disable"))
          throw new ApiError("challenge_expired");
        const challenge = await consumeChallenge(
          tx,
          getAttempt(cookies, "disable"),
          "disable",
          userId,
        );
        if (challenge.generation !== user.session_generation)
          throw new ApiError("auth_failed");
        const keys = await tx
          .select()
          .from(passkeys)
          .where(eq(passkeys.user_id, userId));
        if (!keys.length) throw new ApiError("last_passkey");
        const digests: string[] = JSON.parse(challenge.data);
        await storeRecoveryDigests(tx, userId, digests);
        await tx
          .update(users)
          .set({ pass_hash: null })
          .where(eq(users.id, userId));
        return { success: true };
      }
      await reauthenticate(
        tx,
        user,
        cookies,
        input.proof,
        input.action === "prepareDisable",
      );
      if (input.action === "beginAdd") {
        const result = await beginRegistration("add", user.user, user, tx);
        setAttempt(cookies, "add", result.id);
        return { options: result.options };
      }
      if (input.action === "delete") {
        const keys = await tx
          .select()
          .from(passkeys)
          .where(eq(passkeys.user_id, userId));
        if (!user.pass_hash && keys.length === 1 && keys[0].id === input.id)
          throw new ApiError("last_passkey");
        await tx
          .delete(passkeys)
          .where(and(eq(passkeys.id, input.id), eq(passkeys.user_id, userId)));
        return { success: true };
      }
      if (input.action === "password") {
        await tx
          .update(users)
          .set({ pass_hash: await bcrypt.hash(input.password, 10) })
          .where(eq(users.id, userId));
        return { success: true };
      }
      if (input.action === "codes")
        return { codes: await replaceRecoveryCodes(tx, userId) };
      const codes = Array.from({ length: 10 }, () =>
        randomToken().slice(0, 32),
      );
      const id = await saveChallenge(
        {
          purpose: "disable",
          user_id: userId,
          generation: user.session_generation,
          challenge: randomToken(),
          data: JSON.stringify(codes.map(recoveryDigest)),
        },
        tx,
      );
      setAttempt(cookies, "disable", id);
      return { codes, attemptId: id };
    },
    { isolationLevel: "read committed" },
  );
}
