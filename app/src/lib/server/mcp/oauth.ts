/**
 * @fileoverview MCP OAuth2.1 アクセストークン・リフレッシュトークンの発行と検証
 *
 * 既存セッション用JWT秘密鍵を流用し、`aud` クレームで用途を区別する。
 */

import { createHash } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { getJwtSecret } from "../env";

/** アクセストークンの aud クレーム */
const ACCESS_AUDIENCE = "glatasks-mcp";
/** リフレッシュトークンの aud クレーム */
const REFRESH_AUDIENCE = "glatasks-mcp-refresh";

/** アクセストークン有効期間（秒） */
export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
/** リフレッシュトークン有効期間（秒） */
export const REFRESH_TOKEN_TTL_SECONDS = 30 * 24 * 60 * 60;

function getSecret(): Uint8Array {
  const base64Secret = getJwtSecret();
  return Uint8Array.from(atob(base64Secret), (c) => c.codePointAt(0)!);
}

export interface AccessTokenPayload {
  userId: number;
  clientId: string;
  scope: string;
  expiresAt: number;
}

export async function createAccessToken(params: {
  userId: number;
  clientId: string;
  scope: string;
}): Promise<string> {
  return new SignJWT({
    sub: String(params.userId),
    client_id: params.clientId,
    scope: params.scope,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setAudience(ACCESS_AUDIENCE)
    .setExpirationTime(`${ACCESS_TOKEN_TTL_SECONDS}s`)
    .sign(getSecret());
}

export async function verifyAccessToken(
  token: string,
): Promise<AccessTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      audience: ACCESS_AUDIENCE,
    });
    const userId = payload.sub ? parseInt(payload.sub, 10) : NaN;
    if (!Number.isFinite(userId)) return null;
    const clientId =
      typeof payload.client_id === "string" ? payload.client_id : "";
    const scope = typeof payload.scope === "string" ? payload.scope : "";
    if (!clientId) return null;
    return {
      userId,
      clientId,
      scope,
      expiresAt: payload.exp ?? 0,
    };
  } catch {
    return null;
  }
}

export async function createRefreshToken(params: {
  userId: number;
  clientId: string;
  scope: string;
}): Promise<string> {
  return new SignJWT({
    sub: String(params.userId),
    client_id: params.clientId,
    scope: params.scope,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setAudience(REFRESH_AUDIENCE)
    .setExpirationTime(`${REFRESH_TOKEN_TTL_SECONDS}s`)
    .sign(getSecret());
}

export interface RefreshTokenPayload {
  userId: number;
  clientId: string;
  scope: string;
}

export async function verifyRefreshToken(
  token: string,
): Promise<RefreshTokenPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret(), {
      audience: REFRESH_AUDIENCE,
    });
    const userId = payload.sub ? parseInt(payload.sub, 10) : NaN;
    if (!Number.isFinite(userId)) return null;
    const clientId =
      typeof payload.client_id === "string" ? payload.client_id : "";
    const scope = typeof payload.scope === "string" ? payload.scope : "";
    if (!clientId) return null;
    return { userId, clientId, scope };
  } catch {
    return null;
  }
}

/**
 * PKCE の code_verifier が code_challenge と一致するか検証する。
 * 現状は MCP 仕様で必須の S256 のみ許容する（plain は脆弱なため非対応）。
 */
export function verifyPkce(
  verifier: string,
  challenge: string,
  method: string,
): boolean {
  if (method !== "S256") return false;
  const encoded = createHash("sha256").update(verifier).digest("base64url");
  return encoded === challenge;
}
