/**
 * @fileoverview OAuth 2.0 Dynamic Client Registration エンドポイント (RFC 7591)
 *
 * MCP クライアントが初回接続時に呼び出し、client_id を取得する。
 * 本エンドポイントは認証不要（公開）で運用する。
 */

import { json, error } from "@sveltejs/kit";
import crypto from "node:crypto";
import { z } from "zod";
import { registerClient } from "$lib/server/mcp/store";
import type { RequestHandler } from "./$types";

const RegisterRequestSchema = z.object({
  redirect_uris: z.array(z.string().url()).min(1),
  token_endpoint_auth_method: z.string().default("client_secret_basic"),
  grant_types: z
    .array(z.string())
    .default(["authorization_code", "refresh_token"]),
  response_types: z.array(z.string()).default(["code"]),
  client_name: z.string().optional(),
  scope: z.string().optional(),
});

export const POST: RequestHandler = async ({ request }) => {
  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    error(400, "invalid_client_metadata");
  }
  const parsed = RegisterRequestSchema.safeParse(payload);
  if (!parsed.success) {
    return json(
      {
        error: "invalid_client_metadata",
        error_description: parsed.error.message,
      },
      { status: 400 },
    );
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
