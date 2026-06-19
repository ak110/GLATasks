/**
 * @fileoverview OAuth 2.0 Protected Resource Metadata (RFC 9728)
 *
 * MCP の Streamable HTTP エンドポイント `/mcp` が認証失敗時に
 * 本メタデータURLを WWW-Authenticate ヘッダーで示す。
 */

import { json } from "@sveltejs/kit";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = ({ url }) => {
  return json({
    resource: `${url.origin}/mcp`,
    authorization_servers: [url.origin],
    scopes_supported: ["mcp"],
    bearer_methods_supported: ["header"],
  });
};
