/**
 * @fileoverview OAuth 2.0 Dynamic Client Registration エンドポイント (RFC 7591)
 *
 * MCP クライアントが初回接続時に呼び出し、client_id を取得する。
 * 本エンドポイントは認証不要（公開）で運用する。
 */

import { json } from "@sveltejs/kit";
import { errorResponse } from "#lib/server/mcp/oauth-response.ts";
import {
  OAUTH_GRANT_TYPES,
  OAUTH_RESPONSE_TYPES,
} from "#lib/server/mcp/oauth-config.ts";
import crypto from "node:crypto";
import { z } from "zod";
import { registerClient } from "#lib/server/mcp/store.ts";
import type { RequestHandler } from "./$types";

const RegisterRequestSchema = z.object({
  redirect_uris: z.array(z.string().url()).min(1),
  token_endpoint_auth_method: z.string().default("client_secret_basic"),
  grant_types: z.array(z.string()).default(OAUTH_GRANT_TYPES),
  response_types: z.array(z.string()).default(OAUTH_RESPONSE_TYPES),
  client_name: z.string().optional(),
  scope: z.string().optional(),
});

export const POST: RequestHandler = async ({ request }) => {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return errorResponse("invalid_client_metadata", "JSONとして解析できません");
  }
  const parsed = RegisterRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return errorResponse("invalid_client_metadata", parsed.error.message);
  }
  const metadata = parsed.data;
  const isPublic = metadata.token_endpoint_auth_method === "none";
  const client = registerClient({
    redirect_uris: metadata.redirect_uris,
    token_endpoint_auth_method: metadata.token_endpoint_auth_method,
    grant_types: metadata.grant_types,
    response_types: metadata.response_types,
    client_name: metadata.client_name,
    scope: metadata.scope,
    client_secret: isPublic
      ? undefined
      : crypto.randomBytes(32).toString("hex"),
    // client_secret_expires_at=0 は無期限を意味する（RFC 7591）
    client_secret_expires_at: isPublic ? undefined : 0,
  });
  return json(client, { status: 201 });
};
