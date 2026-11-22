import { json } from "@sveltejs/kit";
import {
  OAUTH_PATHS,
  OAUTH_RESPONSE_TYPES,
  OAUTH_GRANT_TYPES,
  OAUTH_CHALLENGE_METHODS,
  OAUTH_AUTH_METHODS,
  OAUTH_SCOPES,
} from "#lib/server/mcp/oauth-config.ts";
import type { RequestHandler } from "./$types";

export const GET: RequestHandler = ({ url }) => {
  const issuer = url.origin;
  return json({
    issuer,
    authorization_endpoint: `${issuer}${OAUTH_PATHS.authorize}`,
    token_endpoint: `${issuer}${OAUTH_PATHS.token}`,
    registration_endpoint: `${issuer}${OAUTH_PATHS.register}`,
    response_types_supported: OAUTH_RESPONSE_TYPES,
    grant_types_supported: OAUTH_GRANT_TYPES,
    code_challenge_methods_supported: OAUTH_CHALLENGE_METHODS,
    token_endpoint_auth_methods_supported: OAUTH_AUTH_METHODS,
    scopes_supported: OAUTH_SCOPES,
  });
};
