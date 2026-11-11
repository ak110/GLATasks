import { and, eq, isNull } from "drizzle-orm";
import type { z } from "zod";
import type { Cookies } from "@sveltejs/kit";
import type { PublicPasskeySchema } from "#lib/passkey-schemas.ts";
import { getDb } from "../db";
import { users, passkeys, recoveryCodes } from "../schema";
import { ApiError } from "../api-errors";
import {
  consumeChallenge,
  lockUser,
  recoveryDigest,
  replaceRecoveryCodes,
} from "./passkey-common";
import {
  authenticate,
  beginAuthentication,
  beginRegistration,
  insertPasskey,
  verifiedRegistration,
} from "./passkey-webauthn";
import {
  clearRecoveryCookie,
  getAttempt,
  readRecoveryCookie,
  setAttempt,
  setRecoveryCookie,
} from "../passkey-cookies";
import { createSessionToken, setSessionCookie } from "../session";

export async function publicPasskey(
  input: z.infer<typeof PublicPasskeySchema>,
  cookies: Cookies,
) {
  if (input.action === "beginLogin") {
    const result = await beginAuthentication();
    setAttempt(cookies, "login", result.id);
    return { options: result.options };
  }
  if (input.action === "beginRegister") {
    const existing = await getDb()
      .select()
      .from(users)
      .where(eq(users.user, input.userId));
    if (existing.length) throw new ApiError("user_id_conflict");
    const result = await beginRegistration("register", input.userId);
    setAttempt(cookies, "register", result.id);
    return { options: result.options };
  }
  if (input.action === "recover") {
    const user = await recover(input.userId, input.code);
    await setRecoveryCookie(cookies, user.id, user.session_generation);
    return { recovery: true };
  }
  if (input.action === "beginRecovery") {
    const recovery = await readRecoveryCookie(cookies);
    const [user] = await getDb()
      .select()
      .from(users)
      .where(eq(users.id, recovery.id));
    if (!user || user.session_generation !== recovery.generation)
      throw new ApiError("auth_failed");
    const result = await beginRegistration("recover-register", user.user, user);
    setAttempt(cookies, "recover-register", result.id);
    return { options: result.options };
  }
  const result = await getDb().transaction(
    async (tx) => {
      if (input.action === "finishLogin") {
        const user = await authenticate(
          tx,
          getAttempt(cookies, "login"),
          input.response,
        );
        await tx
          .update(users)
          .set({ last_login: new Date() })
          .where(eq(users.id, user.id));
        return { id: user.id, generation: user.session_generation };
      }
      if (input.action === "finishRegister") {
        const challenge = await consumeChallenge(
          tx,
          getAttempt(cookies, "register"),
          "register",
        );
        const credential = await verifiedRegistration(
          challenge,
          input.response,
        );
        const [{ id }] = await tx
          .insert(users)
          .values({
            user: challenge.user_name!,
            webauthn_handle: challenge.handle,
            joined: new Date(),
            last_login: new Date(),
          })
          .$returningId();
        await insertPasskey(tx, id, credential, "最初のパスキー");
        return { id, generation: 0, codes: await replaceRecoveryCodes(tx, id) };
      }
      const recovery = await readRecoveryCookie(cookies);
      const user = await lockUser(tx, recovery.id);
      if (user.session_generation !== recovery.generation)
        throw new ApiError("auth_failed");
      const challenge = await consumeChallenge(
        tx,
        getAttempt(cookies, "recover-register"),
        "recover-register",
        user.id,
      );
      if (challenge.generation !== user.session_generation)
        throw new ApiError("auth_failed");
      const credential = await verifiedRegistration(challenge, input.response);
      await tx.delete(passkeys).where(eq(passkeys.user_id, user.id));
      await insertPasskey(tx, user.id, credential, "復旧後のパスキー");
      await tx
        .update(users)
        .set({
          webauthn_handle: challenge.handle,
          session_generation: user.session_generation + 1,
          last_login: new Date(),
          recovery_failures: 0,
          recovery_locked_until: null,
        })
        .where(eq(users.id, user.id));
      return {
        id: user.id,
        generation: user.session_generation + 1,
        codes: await replaceRecoveryCodes(tx, user.id),
      };
    },
    { isolationLevel: "read committed" },
  );
  setSessionCookie(
    cookies,
    await createSessionToken(result.id, result.generation),
  );
  if (input.action === "finishRecovery") clearRecoveryCookie(cookies);
  return { success: true, codes: "codes" in result ? result.codes : undefined };
}

/** 失敗回数をcommitしてから入口で拒否する。例外によるrollbackで制限を無効化しない。 */
export async function recover(userName: string, code: string) {
  const result = await getDb().transaction(
    async (tx) => {
      const [user] = await tx
        .select()
        .from(users)
        .where(eq(users.user, userName))
        .for("update");
      if (
        !user ||
        (user.recovery_locked_until && user.recovery_locked_until > new Date())
      )
        return undefined;
      const [used] = await tx
        .update(recoveryCodes)
        .set({ used: new Date() })
        .where(
          and(
            eq(recoveryCodes.user_id, user.id),
            eq(recoveryCodes.digest, recoveryDigest(code)),
            isNull(recoveryCodes.used),
          ),
        );
      if (used.affectedRows !== 1) {
        const failures = user.recovery_locked_until
          ? 1
          : user.recovery_failures + 1;
        await tx
          .update(users)
          .set({
            recovery_failures: failures,
            recovery_locked_until:
              failures >= 10 ? new Date(Date.now() + 900_000) : null,
          })
          .where(eq(users.id, user.id));
        return undefined;
      }
      await tx
        .update(users)
        .set({ recovery_failures: 0, recovery_locked_until: null })
        .where(eq(users.id, user.id));
      return user;
    },
    { isolationLevel: "read committed" },
  );
  if (!result) throw new ApiError("recovery_failed");
  return result;
}
