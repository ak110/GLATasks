import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from "@simplewebauthn/server";
import type {
  AuthenticationResponseJSON,
  RegistrationResponseJSON,
  WebAuthnCredential,
} from "@simplewebauthn/server";
import { and, eq } from "drizzle-orm";
import { passkeys, users } from "../schema";
import { ApiError } from "../api-errors";
import { getDb } from "../db";
import {
  consumeChallenge,
  lockUser,
  randomToken,
  rpConfig,
  saveChallenge,
} from "./passkey-common";
import type { AuthTransaction, AuthUser, Challenge } from "./passkey-common";

export async function beginRegistration(
  purpose: "register" | "add" | "recover-register",
  userName: string,
  user?: AuthUser,
  db: AuthTransaction | ReturnType<typeof getDb> = getDb(),
) {
  const config = rpConfig();
  const handle = user?.webauthn_handle ?? randomToken();
  const existing = user
    ? await db.select().from(passkeys).where(eq(passkeys.user_id, user.id))
    : [];
  const options = await generateRegistrationOptions({
    rpName: "GLATasks",
    rpID: config.rpID,
    userName,
    userID: Buffer.from(handle, "base64url"),
    attestationType: "none",
    authenticatorSelection: {
      residentKey: "required",
      userVerification: "required",
    },
    excludeCredentials: existing.map((key) => ({ id: key.id })),
    extensions: { credProps: true },
  });
  const id = await saveChallenge(
    {
      purpose,
      challenge: options.challenge,
      user_id: user?.id,
      user_name: userName,
      handle,
      generation: user?.session_generation ?? 0,
    },
    db,
  );
  return { id, options: { ...options, extensions: { credProps: true } } };
}

export async function verifiedRegistration(
  challenge: Challenge,
  response: RegistrationResponseJSON,
) {
  const config = rpConfig();
  try {
    const result = await verifyRegistrationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedRPID: config.rpID,
      expectedOrigin: config.expectedOrigin,
      requireUserVerification: true,
    });
    if (
      !result.verified ||
      response.clientExtensionResults.credProps?.rk === false
    )
      throw new ApiError("auth_failed");
    return result.registrationInfo.credential;
  } catch {
    throw new ApiError("auth_failed");
  }
}

export async function insertPasskey(
  tx: AuthTransaction,
  userId: number,
  credential: WebAuthnCredential,
  name: string,
) {
  await tx.insert(passkeys).values({
    id: credential.id,
    user_id: userId,
    public_key: Buffer.from(credential.publicKey).toString("base64url"),
    counter: credential.counter,
    transports: JSON.stringify(credential.transports ?? []),
    name,
    created: new Date(),
  });
}

export async function beginAuthentication(userId?: number) {
  const config = rpConfig();
  const options = await generateAuthenticationOptions({
    rpID: config.rpID,
    userVerification: "required",
  });
  const generation = userId
    ? (await getDb().select().from(users).where(eq(users.id, userId)))[0]
        ?.session_generation
    : 0;
  const id = await saveChallenge({
    purpose: userId ? "reauth" : "login",
    challenge: options.challenge,
    user_id: userId,
    generation,
  });
  return { id, options: { ...options, extensions: undefined } };
}

export async function authenticate(
  tx: AuthTransaction,
  attemptId: string,
  response: AuthenticationResponseJSON,
  expectedUser?: AuthUser,
) {
  const challenge = await consumeChallenge(
    tx,
    attemptId,
    expectedUser ? "reauth" : "login",
    expectedUser?.id,
  );
  // ログインも利用者→資格情報の順にロックする。削除・復旧と同時でも消えた資格情報を受理しない。
  const [candidate] = await tx
    .select()
    .from(passkeys)
    .where(eq(passkeys.id, response.id));
  if (!candidate || (expectedUser && candidate.user_id !== expectedUser.id))
    throw new ApiError("auth_failed");
  const user = expectedUser ?? (await lockUser(tx, candidate.user_id));
  const [key] = await tx
    .select()
    .from(passkeys)
    .where(and(eq(passkeys.id, response.id), eq(passkeys.user_id, user.id)))
    .for("update");
  if (
    !key ||
    (expectedUser && challenge.generation !== user.session_generation) ||
    response.response.userHandle !== user.webauthn_handle
  )
    throw new ApiError("auth_failed");
  const config = rpConfig();
  try {
    const result = await verifyAuthenticationResponse({
      response,
      expectedChallenge: challenge.challenge,
      expectedRPID: config.rpID,
      expectedOrigin: config.expectedOrigin,
      requireUserVerification: true,
      credential: {
        id: key.id,
        publicKey: Buffer.from(key.public_key, "base64url"),
        counter: key.counter,
      },
    });
    if (!result.verified) throw new ApiError("auth_failed");
    await tx
      .update(passkeys)
      .set({
        counter: result.authenticationInfo.newCounter,
        last_used: new Date(),
      })
      .where(eq(passkeys.id, key.id));
    return user;
  } catch {
    throw new ApiError("auth_failed");
  }
}
