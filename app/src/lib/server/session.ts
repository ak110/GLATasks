/**
 * @fileoverview セッショントークン（JWT/HS256）の生成・検証
 */

import type { Cookies } from "@sveltejs/kit";
import { SignJWT, jwtVerify } from "jose";
import { getSecret } from "./jwt-key";

const SESSION_AUDIENCE = "glatasks-session";

/**
 * ユーザーIDを含む署名済みセッショントークンを生成する。
 */
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

/**
 * セッションCookie名を返す。環境変数`SESSION_COOKIE_NAME`が空でなければその値を使う。
 *
 * 既存の名前で運用する環境（本番など）は設定で旧名を使い続け、端末ごとの再ログインを避ける。
 */
export function getSessionCookieName(): string {
  return process.env.SESSION_COOKIE_NAME?.trim() || DEFAULT_SESSION_COOKIE_NAME;
}

/** セッション Cookie 有効期限（秒） */
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

/**
 * セッショントークンを Cookie にセットする。
 */
export function setSessionCookie(cookies: Cookies, token: string): void {
  cookies.set(getSessionCookieName(), token, {
    ...SESSION_COOKIE_ATTRIBUTES,
    maxAge: SESSION_MAX_AGE,
  });
}

/**
 * セッションCookieを削除する。
 */
export function deleteSessionCookie(cookies: Cookies): void {
  cookies.delete(getSessionCookieName(), SESSION_COOKIE_ATTRIBUTES);
}

/**
 * セッショントークンを検証してユーザーIDを返す。
 * 無効なトークンの場合は null を返す。
 */
export async function verifySessionToken(
  token: string,
  getGeneration: (userId: number) => Promise<number | undefined> = async () =>
    0,
): Promise<number | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      algorithms: ["HS256"],
    });
    // 既存のaud無しCookieは維持し、同じ鍵で署名したMCP用JWTの転用を拒否する。
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
