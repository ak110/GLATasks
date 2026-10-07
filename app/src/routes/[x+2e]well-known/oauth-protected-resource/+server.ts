/**
 * @fileoverview OAuth 2.0 Protected Resource Metadata (RFC 9728)
 *
 * MCP の Streamable HTTP エンドポイント `/mcp` が認証失敗時に
 * 本メタデータURLを WWW-Authenticate ヘッダーで示す。
 */

import { json } from "@sveltejs/kit";
import { OAUTH_PATHS, OAUTH_SCOPES } from "#lib/server/mcp/oauth-config.ts";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = ({ url }) => {
  return json({
    resource: `${url.origin}${OAUTH_PATHS.resource}`,
    authorization_servers: [url.origin],
    scopes_supported: OAUTH_SCOPES,
    bearer_methods_supported: ["header"],
  });
};
