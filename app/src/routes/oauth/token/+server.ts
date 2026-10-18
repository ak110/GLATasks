/**
 * @fileoverview OAuth 2.1 トークンエンドポイント
 *
 * grant_type = authorization_code: PKCE 検証のうえアクセストークン・リフレッシュトークン発行
 * grant_type = refresh_token: 既存リフレッシュトークンを検証し新規アクセストークン発行
 */

import { json } from "@sveltejs/kit";
import {
  RESTART_AUTHORIZATION,
  errorResponse,
} from "#lib/server/mcp/oauth-response.ts";
import { authenticateClient } from "#lib/server/mcp/client-auth.ts";
import { OAUTH_GRANTS } from "#lib/server/mcp/oauth-config.ts";
import { consumeAuthorizationCode } from "#lib/server/mcp/store.ts";
import {
  createAccessToken,
  createRefreshToken,
  verifyPkce,
  verifyRefreshToken,
  ACCESS_TOKEN_TTL_SECONDS,
} from "#lib/server/mcp/oauth.ts";
import type { RequestHandler } from "./$types";

async function handleAuthorizationCode(
  request: Request,
  form: FormData,
): Promise<Response> {
  const credentials = authenticateClient(request, form);
  if (credentials instanceof Response) return credentials;
  const code = form.get("code");
  const redirectUri = form.get("redirect_uri");
  const codeVerifier = form.get("code_verifier");
  if (
    typeof code !== "string" ||
    typeof redirectUri !== "string" ||
    typeof codeVerifier !== "string"
  ) {
    return errorResponse("invalid_request", {
      reason: "code, redirect_uri and code_verifier are required.",
      nextAction: "Send all three form fields and retry the token request.",
    });
  }

  const record = consumeAuthorizationCode(code);
  if (!record)
    return errorResponse("invalid_grant", {
      reason: "The authorization code is unknown, already used, or expired.",
      nextAction: RESTART_AUTHORIZATION,
    });
  if (record.client_id !== credentials.clientId) {
    return errorResponse("invalid_grant", {
      reason: "The authorization code was issued to a different client.",
      nextAction: `Exchange the code with the client_id that requested it. ${RESTART_AUTHORIZATION}`,
    });
  }
  if (record.redirect_uri !== redirectUri) {
    return errorResponse("invalid_grant", {
      reason: "redirect_uri does not match the authorization request.",
      nextAction:
        "Send the same redirect_uri that was used in the authorization request.",
    });
  }
  if (
    !verifyPkce(
      codeVerifier,
      record.code_challenge,
      record.code_challenge_method,
    )
  ) {
    return errorResponse("invalid_grant", {
      reason: "PKCE verification failed.",
      nextAction: `Send the code_verifier that produced the code_challenge. ${RESTART_AUTHORIZATION}`,
    });
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
  const credentials = authenticateClient(request, form);
  if (credentials instanceof Response) return credentials;
  const refreshToken = form.get("refresh_token");
  if (typeof refreshToken !== "string") {
    return errorResponse("invalid_request", {
      reason: "refresh_token is required.",
      nextAction: "Send the refresh_token form field and retry the request.",
    });
  }

  const payload = await verifyRefreshToken(refreshToken);
  if (!payload)
    return errorResponse("invalid_grant", {
      reason: "The refresh token is invalid or expired.",
      nextAction: RESTART_AUTHORIZATION,
    });
  if (payload.clientId !== credentials.clientId) {
    return errorResponse("invalid_grant", {
      reason: "The refresh token was issued to a different client.",
      nextAction: `Send the refresh token with the client_id that obtained it. ${RESTART_AUTHORIZATION}`,
    });
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
    return errorResponse("invalid_request", {
      reason: "The request body could not be parsed as a form.",
      nextAction:
        "Send application/x-www-form-urlencoded parameters and retry the request.",
    });
  }
  const grantType = form.get("grant_type");
  if (grantType === OAUTH_GRANTS.authorizationCode) {
    return handleAuthorizationCode(request, form);
  }
  if (grantType === OAUTH_GRANTS.refreshToken) {
    return handleRefreshToken(request, form);
  }
  // 受け取った値はASCII以外を含み得るため、error_descriptionへ転記しない
  return errorResponse("unsupported_grant_type", {
    reason: "The grant_type is not supported.",
    nextAction: `Send grant_type=${OAUTH_GRANTS.authorizationCode} or grant_type=${OAUTH_GRANTS.refreshToken}.`,
  });
};
