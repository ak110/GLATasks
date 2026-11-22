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
