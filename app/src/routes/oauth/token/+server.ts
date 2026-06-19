/**
 * @fileoverview OAuth 2.1 トークンエンドポイント
 *
 * grant_type = authorization_code: PKCE 検証のうえアクセストークン・リフレッシュトークン発行
 * grant_type = refresh_token: 既存リフレッシュトークンを検証し新規アクセストークン発行
 */

import { json } from "@sveltejs/kit";
import { consumeAuthorizationCode, getClient } from "$lib/server/mcp/store";
import {
  createAccessToken,
  createRefreshToken,
  verifyPkce,
  verifyRefreshToken,
  ACCESS_TOKEN_TTL_SECONDS,
} from "$lib/server/mcp/oauth";
import type { RequestHandler } from "./$types";

function errorResponse(
  code: string,
  description: string,
  status = 400,
): Response {
  return json({ error: code, error_description: description }, { status });
}

function extractClientCredentials(
  request: Request,
  form: FormData,
): { clientId: string; clientSecret: string | null } | null {
  const authHeader = request.headers.get("authorization");
  if (authHeader?.startsWith("Basic ")) {
    const decoded = atob(authHeader.slice(6));
    const idx = decoded.indexOf(":");
    if (idx < 0) return null;
    return {
      clientId: decodeURIComponent(decoded.slice(0, idx)),
      clientSecret: decodeURIComponent(decoded.slice(idx + 1)),
    };
  }
  const clientId = form.get("client_id");
  if (typeof clientId !== "string" || !clientId) return null;
  const clientSecret = form.get("client_secret");
  return {
    clientId,
    clientSecret: typeof clientSecret === "string" ? clientSecret : null,
  };
}

async function handleAuthorizationCode(
  request: Request,
  form: FormData,
): Promise<Response> {
  const code = form.get("code");
  const redirectUri = form.get("redirect_uri");
  const codeVerifier = form.get("code_verifier");
  if (
    typeof code !== "string" ||
    typeof redirectUri !== "string" ||
    typeof codeVerifier !== "string"
  ) {
    return errorResponse("invalid_request", "missing fields");
  }
  const credentials = extractClientCredentials(request, form);
  if (!credentials)
    return errorResponse("invalid_client", "client_id required");

  const client = getClient(credentials.clientId);
  if (!client) return errorResponse("invalid_client", "unknown client", 401);
  if (client.client_secret) {
    if (credentials.clientSecret !== client.client_secret) {
      return errorResponse("invalid_client", "secret mismatch", 401);
    }
  }
  const record = consumeAuthorizationCode(code);
  if (!record) return errorResponse("invalid_grant", "code unknown or expired");
  if (record.client_id !== credentials.clientId) {
    return errorResponse("invalid_grant", "client mismatch");
  }
  if (record.redirect_uri !== redirectUri) {
    return errorResponse("invalid_grant", "redirect_uri mismatch");
  }
  if (
    !verifyPkce(
      codeVerifier,
      record.code_challenge,
      record.code_challenge_method,
    )
  ) {
    return errorResponse("invalid_grant", "PKCE verification failed");
  }
  const accessToken = await createAccessToken({
    userId: record.user_id,
    clientId: credentials.clientId,
    scope: record.scope,
  });
  const refreshToken = await createRefreshToken({
    userId: record.user_id,
    clientId: credentials.clientId,
    scope: record.scope,
  });
  return json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refreshToken,
    scope: record.scope,
  });
}

async function handleRefreshToken(
  request: Request,
  form: FormData,
): Promise<Response> {
  const refreshToken = form.get("refresh_token");
  if (typeof refreshToken !== "string") {
    return errorResponse("invalid_request", "refresh_token required");
  }
  const credentials = extractClientCredentials(request, form);
  if (!credentials)
    return errorResponse("invalid_client", "client_id required");

  const payload = await verifyRefreshToken(refreshToken);
  if (!payload) return errorResponse("invalid_grant", "refresh token invalid");
  if (payload.clientId !== credentials.clientId) {
    return errorResponse("invalid_grant", "client mismatch");
  }
  const client = getClient(credentials.clientId);
  if (!client) return errorResponse("invalid_client", "unknown client", 401);
  if (client.client_secret) {
    if (credentials.clientSecret !== client.client_secret) {
      return errorResponse("invalid_client", "secret mismatch", 401);
    }
  }
  const accessToken = await createAccessToken({
    userId: payload.userId,
    clientId: payload.clientId,
    scope: payload.scope,
  });
  return json({
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    scope: payload.scope,
  });
}

export const POST: RequestHandler = async ({ request }) => {
  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return errorResponse("invalid_request", "form parse failed");
  }
  const grantType = form.get("grant_type");
  if (grantType === "authorization_code") {
    return handleAuthorizationCode(request, form);
  }
  if (grantType === "refresh_token") {
    return handleRefreshToken(request, form);
  }
  return errorResponse(
    "unsupported_grant_type",
    `unsupported grant_type: ${String(grantType)}`,
  );
};
