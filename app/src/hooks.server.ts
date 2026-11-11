import type { Handle, ServerInit } from "@sveltejs/kit/hooks";
import { redirect } from "@sveltejs/kit";
import { building } from "$app/env";
import {
  getSessionCookieName,
  verifySessionToken,
} from "#lib/server/session.ts";
import { startScheduler } from "#lib/server/scheduler.ts";
import { getSessionGeneration } from "#lib/server/api/passkey-common.ts";
import {
  COOKIELESS_MUTATION_PATHS,
  EXTENSION_EMBEDDABLE_PATHS,
  isPublicPath,
  loginRedirectPath,
} from "#lib/server/auth-routes.ts";

/** 更新要求を拒否する`Sec-Fetch-Site`の値。正規の送信元はGLATasks自身の画面（same-origin）とブラウザーの直接操作（none）だけである。 */
const REJECTED_FETCH_SITES = new Set(["same-site", "cross-site"]);
const MUTATING_METHODS = new Set(["POST", "PATCH", "PUT", "DELETE"]);

/**
 * サーバー起動時に定期処理スケジューラー（定期TODOとカロリー自動記録）を起動する。
 * `building` が真の間（ビルド時）は意図しない初期化処理を避けるため起動しない。
 */
export const init: ServerInit = () => {
  if (building) return;
  startScheduler();
};

/**
 * セッションCookieは`SameSite=None`（Chrome拡張のポップアップ内iframeでログイン状態を使うため）なので、
 * 他サイトからの要求にも付く。その補償として、次の不変条件をこの関数で全経路へ既定で適用する。
 *
 * - Cookie認証の更新要求は同一オリジンからだけ受け付ける（`Sec-Fetch-Site`で判定し、Cookieを読まない入口だけを除く）
 * - 画面は許可した埋め込み元（GLATasks自身と、拡張が開く画面に限りChrome拡張）以外から埋め込めない
 *
 * SvelteKit組み込みのOrigin検査はリバースプロキシ経由の利用でOriginが一致しないため無効のまま保つ。
 * `Sec-Fetch-Site`はブラウザーが自分の見ているオリジン同士で判定するため、プロキシ経由でも同じ画面からの送信はsame-originになる。
 */
export const handle: Handle = async ({ event, resolve }) => {
  const secFetchSite = event.request.headers.get("sec-fetch-site");
  if (
    MUTATING_METHODS.has(event.request.method) &&
    secFetchSite !== null &&
    REJECTED_FETCH_SITES.has(secFetchSite) &&
    !COOKIELESS_MUTATION_PATHS.has(event.url.pathname)
  ) {
    return new Response(
      "Forbidden: requests from other sites cannot change data. Send the request from the GLATasks page on the same origin.",
      { status: 403 },
    );
  }

  // セッション Cookie の検証（JWT/HS256）
  const sessionCookie = event.cookies.get(getSessionCookieName());
  event.locals.user_id = sessionCookie
    ? await verifySessionToken(sessionCookie, getSessionGeneration)
    : null;

  if (!event.locals.user_id && !isPublicPath(event.url.pathname)) {
    if (event.url.pathname.startsWith("/api/")) {
      return new Response(
        "Unauthorized: log in at /auth/login and send the request again.",
        { status: 401 },
      );
    }
    // 更新要求の転送先へ元のURLを付けると、ログイン後にその入口をGETで開き直すことになるため画面のGETに限る。
    // 例外としてChrome拡張のポップアップからの送信は元の画面へ戻す。ログイン後にトップ画面へ移ると、
    // 拡張からの埋め込みを許可しない画面になりブラウザーが表示を拒否するためである（元の画面はGETで入力欄を開き直すだけ）
    redirect(
      302,
      event.request.method === "GET" || isExtensionPopupRequest(event.url)
        ? loginRedirectPath(event.url)
        : "/auth/login",
    );
  }

  const response = await resolve(event);
  setFrameAncestors(response, event.url.pathname);
  return response;
};

/** Chrome拡張のポップアップが埋め込んだ画面からの要求かを返す。拡張は`in_popup=1`を付けて画面を開く。 */
function isExtensionPopupRequest(url: URL): boolean {
  return (
    EXTENSION_EMBEDDABLE_PATHS.has(url.pathname) &&
    url.searchParams.get("in_popup") === "1"
  );
}

/** 埋め込み元を制限する応答ヘッダーを付ける。旧ブラウザー向けの`X-Frame-Options`は拡張を表せないため拡張用の画面には付けない。 */
function setFrameAncestors(response: Response, pathname: string): void {
  if (EXTENSION_EMBEDDABLE_PATHS.has(pathname)) {
    response.headers.set(
      "Content-Security-Policy",
      "frame-ancestors 'self' chrome-extension:",
    );
    return;
  }
  response.headers.set("Content-Security-Policy", "frame-ancestors 'self'");
  response.headers.set("X-Frame-Options", "SAMEORIGIN");
}
