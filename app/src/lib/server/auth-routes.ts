const PUBLIC_PATHS = new Set([
  "/auth/login",
  "/auth/regist_user",
  "/auth/passkey",
  "/auth/recover",
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
 * これらの画面からの転送先（追加後の表示、ログイン後の戻り先など）もこの集合の画面に限る。
 * 集合外の画面へ移るとブラウザーが埋め込みを拒否し、ポップアップに「接続が拒否されました」と表示される。
 */
export const EXTENSION_EMBEDDABLE_PATHS: ReadonlySet<string> = new Set([
  "/share/ingest",
  "/auth/login",
  "/auth/regist_user",
  "/auth/recover",
]);

/**
 * `returnTo` を相対パス（先頭が `/` で `//` で始まらないもの）に限定する。
 * 外部URLへリダイレクトする open redirect 脆弱性を防ぐ。
 */
export function safeReturnTo(value: string | null): string {
  if (!value) return "/";
  if (!value.startsWith("/") || value.startsWith("//")) return "/";
  if (
    value.includes("\\") ||
    Array.from(value).some(
      (character) =>
        character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    )
  )
    return "/";
  return value;
}

/**
 * 未ログインで画面を開いた要求の転送先。ログイン・利用者登録の後に元の画面へ戻れるよう`returnTo`を付ける。
 *
 * Chrome拡張のポップアップは`/share/ingest`を埋め込む。ログイン後にトップ画面へ移ると、
 * 拡張からの埋め込みを許可しない画面になりブラウザーが表示を拒否するため、元の画面へ戻す。
 */
export function loginRedirectPath(url: URL): string {
  const returnTo = `${url.pathname}${url.search}`;
  if (returnTo === "/") return "/auth/login";
  return `/auth/login?returnTo=${encodeURIComponent(returnTo)}`;
}
import { OAUTH_PATHS } from "./mcp/oauth-config";
