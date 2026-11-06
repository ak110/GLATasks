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

/**
 * セッションCookieを読まない更新の入口。送信元判定（同一オリジンだけを受け付ける）の対象から外す。
 *
 * MCPクライアントはブラウザー外や別オリジンから呼び、Cookieではなく登録情報・認可コード・Bearerトークンで認証する。
 * Cookieを読む入口をここへ加えると、他サイトからログイン状態を使った更新を受け付けてしまう。
 */
export const COOKIELESS_MUTATION_PATHS: ReadonlySet<string> = new Set([
  OAUTH_PATHS.token,
  OAUTH_PATHS.register,
  OAUTH_PATHS.resource,
]);

/**
 * Chrome拡張のポップアップ内iframeが開く画面。拡張ページからの埋め込みだけを追加で許可する。
 * 拡張は`/share/ingest`を開き、未ログイン時はログイン・利用者登録の画面へ遷移する。
 */
export const EXTENSION_EMBEDDABLE_PATHS: ReadonlySet<string> = new Set([
  "/share/ingest",
  "/auth/login",
  "/auth/regist_user",
]);
import { OAUTH_PATHS } from "./mcp/oauth-config";
