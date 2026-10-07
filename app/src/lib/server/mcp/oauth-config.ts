export const OAUTH_PATHS = {
  authorize: "/oauth/authorize",
  token: "/oauth/token",
  register: "/oauth/register",
  protectedResourceMetadata: "/.well-known/oauth-protected-resource",
  authorizationServerMetadata: "/.well-known/oauth-authorization-server",
  resource: "/mcp",
} as const;

export const OAUTH_SCOPES = ["mcp"];
export const OAUTH_GRANTS = {
  authorizationCode: "authorization_code",
  refreshToken: "refresh_token",
} as const;
export const OAUTH_GRANT_TYPES = Object.values(OAUTH_GRANTS);
export const OAUTH_RESPONSE_TYPES = ["code"];
export const OAUTH_CHALLENGE_METHODS = ["S256"];
export const OAUTH_AUTH_METHODS = [
  "none",
  "client_secret_basic",
  "client_secret_post",
];
