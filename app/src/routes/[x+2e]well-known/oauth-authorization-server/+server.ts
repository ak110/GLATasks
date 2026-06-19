/**
 * @fileoverview OAuth 2.0 Authorization Server Metadata (RFC 8414)
 *
 * MCP クライアントがリソースサーバーから WWW-Authenticate で示された
 * Protected Resource Metadata 経由で本エンドポイントを発見する。
 */

import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = ({ url }) => {
  const issuer = url.origin;
  return json({
    issuer,
    authorization_endpoint: `${issuer}/oauth/authorize`,
    token_endpoint: `${issuer}/oauth/token`,
    registration_endpoint: `${issuer}/oauth/register`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: [
      "none",
      "client_secret_basic",
      "client_secret_post",
    ],
    scopes_supported: ["mcp"],
  });
};
