import type { Cookies } from "@sveltejs/kit";
import { SignJWT, jwtVerify } from "jose";
import { getSecret } from "./jwt-key";

const SESSION_AUDIENCE = "glatasks-session";

export async function createSessionToken(
  userId: number,
  generation = 0,
): Promise<string> {
  return new SignJWT({ sub: String(userId), generation })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setAudience(SESSION_AUDIENCE)
    .setExpirationTime("365d")
    .sign(getSecret());
}

/**
 * セッションCookie名の既定値。`__Host-`接頭辞は、Secure・Path=/・Domain指定なしを満たすCookieだけに使え、
 * 同じ親ドメインの別サブドメインから上書きされない。
 */
export const DEFAULT_SESSION_COOKIE_NAME = "__Host-gla-session";

export function getSessionCookieName(): string {
  return process.env.SESSION_COOKIE_NAME?.trim() || DEFAULT_SESSION_COOKIE_NAME;
}

const SESSION_MAX_AGE = 365 * 24 * 60 * 60;

/**
 * セッションCookieの属性。発行と削除で同じ値を使う。
 *
 * アプリはリバースプロキシの内側でhttpとして要求を受けるため、`secure`を省くとSvelteKitは非Secureで書き出す。
 * `__Host-`接頭辞のCookieは非Secureの書き込みをブラウザーが無視するため、削除でも`secure`を明示する。
 */
const SESSION_COOKIE_ATTRIBUTES = {
  path: "/",
  httpOnly: true,
  secure: true,
  sameSite: "none",
} as const;

export function setSessionCookie(cookies: Cookies, token: string): void {
  cookies.set(getSessionCookieName(), token, {
    ...SESSION_COOKIE_ATTRIBUTES,
    maxAge: SESSION_MAX_AGE,
  });
}

export function deleteSessionCookie(cookies: Cookies): void {
  cookies.delete(getSessionCookieName(), SESSION_COOKIE_ATTRIBUTES);
}

export async function verifySessionToken(
  token: string,
  getGeneration: (userId: number) => Promise<number | undefined> = async () =>
    0,
): Promise<number | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      algorithms: ["HS256"],
    });
    if (payload.aud !== undefined && payload.aud !== SESSION_AUDIENCE) {
      return null;
    }
    const userId = payload.sub ? parseInt(payload.sub, 10) : null;
    if (userId === null || !Number.isSafeInteger(userId) || userId <= 0)
      return null;
    return (payload.generation ?? 0) === (await getGeneration(userId))
      ? userId
      : null;
  } catch {
    return null;
  }
}

export async function getRecentAuthenticationUntil(
  cookies: Cookies,
  userId: number,
  generation: number,
): Promise<number> {
  const token = cookies.get(getSessionCookieName());
  if (!token) return 0;
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      algorithms: ["HS256"],
    });
    const now = Date.now();
    if (
      payload.aud !== SESSION_AUDIENCE ||
      payload.sub !== String(userId) ||
      payload.generation !== generation ||
      !Number.isSafeInteger(payload.iat) ||
      payload.iat === undefined ||
      payload.iat < 0 ||
      payload.iat * 1000 > now ||
      typeof payload.exp !== "number" ||
      !Number.isFinite(payload.exp) ||
      payload.exp * 1000 <= now
    )
      return 0;
    const until = payload.iat * 1000 + 900_000;
    return now <= until ? until : 0;
  } catch {
    return 0;
  }
}
