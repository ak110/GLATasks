const PUBLIC_PATHS = new Set([
  "/auth/login",
  "/auth/regist_user",
  ...Object.values(OAUTH_PATHS),
  "/healthcheck",
  "/healthcheck/ready",
  "/sw.js",
  "/offline.html",
]);

/** 公開経路だけをセッション認証の対象から外す。 */
export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.has(pathname);
}
import { OAUTH_PATHS } from "./mcp/oauth-config";
