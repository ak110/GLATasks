/**
 * @fileoverview 他オリジンからの更新要求の拒否と、画面の埋め込み制限を稼働中のアプリへのHTTP要求で確かめるe2eテスト
 *
 * `hooks.server.test.ts`は`handle`を直接呼ぶため、フレームワークの版更新や設定変更でhookが実行経路から外れても成功する。
 * 本テストはSvelteKitのルーティングとhookを通った応答だけを判定し、`app/src/routes`の全ルートを対象にする。
 */

import { expect, test } from "@playwright/test";
import {
  COOKIELESS_MUTATION_PATHS,
  EXTENSION_EMBEDDABLE_PATHS,
} from "../src/lib/server/auth-routes";
import { listRoutePaths } from "./helpers/route-paths";

const routes = listRoutePaths({ includePages: true });

/** SSEは応答の本文が終わらず、応答全体を受け取るAPIでは取得できないため、埋め込みヘッダーの確認から外す */
const STREAMING_PATHS = new Set(["/api/events"]);

test("Cookieを読まない入口以外は、他オリジンからの更新要求を拒否する", async ({
  request,
}) => {
  // ログイン済みのCookieを持つ要求として送り、セッション認証の判定より前に拒否されることを確かめる
  const protectedRoutes = routes.filter(
    (pathname) => !COOKIELESS_MUTATION_PATHS.has(pathname),
  );
  expect(protectedRoutes.length).toBeGreaterThan(0);
  for (const pathname of protectedRoutes) {
    for (const site of ["cross-site", "same-site"]) {
      const response = await request.post(pathname, {
        headers: { "Sec-Fetch-Site": site },
        maxRedirects: 0,
      });
      expect(response.status(), `${site} ${pathname}`).toBe(403);
    }
  }
});

test("Cookieを読まない入口は、他オリジンからの更新要求を送信元の判定で拒否しない", async ({
  request,
}) => {
  for (const pathname of COOKIELESS_MUTATION_PATHS) {
    expect(routes).toContain(pathname);
    const response = await request.post(pathname, {
      headers: { "Sec-Fetch-Site": "cross-site" },
      maxRedirects: 0,
    });
    expect(response.status(), pathname).not.toBe(403);
  }
});

test("全ルートの応答が埋め込み元を制限するヘッダーを持つ", async ({
  request,
}) => {
  for (const pathname of routes.filter((p) => !STREAMING_PATHS.has(p))) {
    const response = await request.get(pathname, {
      headers: { "Sec-Fetch-Site": "same-origin" },
      maxRedirects: 0,
    });
    const headers = response.headers();
    if (EXTENSION_EMBEDDABLE_PATHS.has(pathname)) {
      expect(headers["content-security-policy"], pathname).toBe(
        "frame-ancestors 'self' chrome-extension:",
      );
      expect(headers["x-frame-options"], pathname).toBeUndefined();
    } else {
      expect(headers["content-security-policy"], pathname).toBe(
        "frame-ancestors 'self'",
      );
      expect(headers["x-frame-options"], pathname).toBe("SAMEORIGIN");
    }
  }
});
