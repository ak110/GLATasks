import type { Handle } from "@sveltejs/kit/hooks";
import { afterEach, describe, expect, it, vi } from "vitest";
import { listRoutePaths } from "../tests/helpers/route-paths";
vi.mock("$app/env", () => ({ building: false }));

vi.mock("#lib/server/scheduler.ts", () => ({ startScheduler: vi.fn() }));
vi.mock("#lib/server/session.ts", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("#lib/server/session.ts")>();
  return {
    ...actual,
    // 試験ではトークン値"valid"だけをログイン済みとみなす
    verifySessionToken: vi.fn(async (token: string) =>
      token === "valid" ? 1 : null,
    ),
  };
});
const { handle } = await import("./hooks.server");
const { COOKIELESS_MUTATION_PATHS, EXTENSION_EMBEDDABLE_PATHS, safeReturnTo } =
  await import("#lib/server/auth-routes.ts");

type HandleEvent = Parameters<Handle>[0]["event"];

/** `handle`へ渡す要求を作る。`cookieName`のCookieへ有効なセッションを持つ利用者として送る。 */
function makeEvent(
  pathname: string,
  {
    method = "POST",
    fetchSite,
    cookieName = "__Host-gla-session",
  }: { method?: string; fetchSite?: string; cookieName?: string } = {},
) {
  const headers = new Headers();
  if (fetchSite !== undefined) headers.set("sec-fetch-site", fetchSite);
  const url = new URL(`https://glatasks.example${pathname}`);
  return {
    request: new Request(url, { method, headers }),
    url,
    cookies: {
      get: (name: string) => (name === cookieName ? "valid" : undefined),
    },
    locals: {},
  } as unknown as HandleEvent;
}

async function run(event: HandleEvent) {
  const resolve = vi.fn(async () => new Response("resolved"));
  const response = await handle({ event, resolve });
  return { response, resolved: resolve.mock.calls.length > 0 };
}

afterEach(() => {
  delete process.env.SESSION_COOKIE_NAME;
});

describe("セッション認証の入口", () => {
  it("未ログインの共有POSTはactionへ到達せずログインへ戻る", async () => {
    const event = makeEvent("/share/ingest", { cookieName: "other" });
    const resolve = vi.fn(async () => new Response("action"));
    await expect(handle({ event, resolve })).rejects.toMatchObject({
      status: 302,
      location: "/auth/login",
    });
    expect(resolve).not.toHaveBeenCalled();
  });

  it("未ログインのポップアップからの共有POSTは、元の画面をreturnToに付けてログインへ転送する", async () => {
    // ログイン後にトップ画面へ移ると拡張からの埋め込みが拒否されるため、タスク追加画面へ戻す
    const event = makeEvent("/share/ingest?in_popup=1", {
      cookieName: "other",
    });
    const resolve = vi.fn(async () => new Response("action"));
    await expect(handle({ event, resolve })).rejects.toMatchObject({
      status: 302,
      location: "/auth/login?returnTo=%2Fshare%2Fingest%3Fin_popup%3D1",
    });
    expect(resolve).not.toHaveBeenCalled();
  });

  it.each([
    // Chrome拡張のポップアップはタスク追加画面を埋め込み、ログイン後にこの画面へ戻る必要がある
    [
      "/share/ingest?title=t&in_popup=1",
      "/auth/login?returnTo=%2Fshare%2Fingest%3Ftitle%3Dt%26in_popup%3D1",
    ],
    ["/timers", "/auth/login?returnTo=%2Ftimers"],
    ["/", "/auth/login"],
  ])(
    "未ログインで画面%sを開くと、元の画面をreturnToに付けてログインへ転送する",
    async (pathname, location) => {
      const event = makeEvent(pathname, { method: "GET", cookieName: "other" });
      await expect(
        handle({ event, resolve: vi.fn(async () => new Response("page")) }),
      ).rejects.toMatchObject({ status: 302, location });
    },
  );
});

describe("returnToの検証", () => {
  it.each([
    ["/share/ingest?in_popup=1", "/share/ingest?in_popup=1"],
    [null, "/"],
    ["https://evil.example/", "/"],
    ["//evil.example/", "/"],
    ["/\\evil.example/", "/"],
    ["/\nevil.example/", "/"],
  ])("returnTo=%sは%sへ戻す", (value, expected) => {
    expect(safeReturnTo(value)).toBe(expected);
  });
});

describe("他オリジンからの更新要求", () => {
  it.each([
    "/oauth/authorize",
    "/share/ingest",
    "/auth/login",
    "/auth/regist_user",
    "/auth/logout",
    "/api/trpc/tasks.add",
  ])("%s へのcross-site・same-siteの更新要求を403にする", async (pathname) => {
    for (const fetchSite of ["cross-site", "same-site"]) {
      for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
        const { response, resolved } = await run(
          makeEvent(pathname, { method, fetchSite }),
        );
        expect(response.status, `${method} ${fetchSite}`).toBe(403);
        expect(resolved).toBe(false);
      }
    }
  });

  it.each(["same-origin", "none", undefined])(
    "Sec-Fetch-Siteが%sの更新要求は従来どおり処理へ進む",
    async (fetchSite) => {
      const { response, resolved } = await run(
        makeEvent("/oauth/authorize", { fetchSite }),
      );
      expect(resolved).toBe(true);
      expect(response.status).toBe(200);
    },
  );

  it("読み取り要求は送信元を問わず処理へ進む", async () => {
    const { resolved } = await run(
      makeEvent("/oauth/authorize", { method: "GET", fetchSite: "cross-site" }),
    );
    expect(resolved).toBe(true);
  });

  it("Cookieを読まない入口は他オリジンからの更新要求も受け付ける", async () => {
    for (const pathname of COOKIELESS_MUTATION_PATHS) {
      const { resolved } = await run(
        makeEvent(pathname, { fetchSite: "cross-site", cookieName: "other" }),
      );
      expect(resolved, pathname).toBe(true);
    }
  });

  it("全ルートのうちCookieを読まない入口以外は、他オリジンからの更新要求を拒否する", async () => {
    const routes = listRoutePaths();
    // 除外集合はルートとして実在する入口だけで構成する
    for (const pathname of COOKIELESS_MUTATION_PATHS) {
      expect(routes).toContain(pathname);
    }
    const protectedRoutes = routes.filter(
      (pathname) => !COOKIELESS_MUTATION_PATHS.has(pathname),
    );
    // 起草時の全16ルート（`/api/`外14件と`/api/events`・`/api/trpc`）を下回る列挙は走査の誤りとみなす
    expect(routes.length).toBeGreaterThanOrEqual(16);
    for (const pathname of protectedRoutes) {
      const { response, resolved } = await run(
        makeEvent(pathname, { fetchSite: "cross-site" }),
      );
      expect(response.status, pathname).toBe(403);
      expect(resolved, pathname).toBe(false);
    }
  });
});

describe("他オリジンへの埋め込み", () => {
  it("全ルートの応答へ埋め込み元を制限するヘッダーを付ける", async () => {
    for (const pathname of listRoutePaths()) {
      const { response } = await run(
        makeEvent(pathname, { method: "GET", fetchSite: "same-origin" }),
      );
      const csp = response.headers.get("Content-Security-Policy");
      if (EXTENSION_EMBEDDABLE_PATHS.has(pathname)) {
        expect(csp, pathname).toBe("frame-ancestors 'self' chrome-extension:");
        expect(response.headers.get("X-Frame-Options"), pathname).toBeNull();
      } else {
        expect(csp, pathname).toBe("frame-ancestors 'self'");
        expect(response.headers.get("X-Frame-Options"), pathname).toBe(
          "SAMEORIGIN",
        );
      }
    }
  });

  it("OAuth同意画面はChrome拡張を含む他オリジンから埋め込めない", async () => {
    const { response } = await run(
      makeEvent("/oauth/authorize", { method: "GET" }),
    );
    expect(response.headers.get("Content-Security-Policy")).toBe(
      "frame-ancestors 'self'",
    );
  });
});

describe("セッションCookie名", () => {
  it("未指定なら__Host-gla-sessionのCookieでログイン状態を判定する", async () => {
    const event = makeEvent("/", { method: "GET" });
    await run(event);
    expect(event.locals.user_id).toBe(1);
  });

  it("SESSION_COOKIE_NAMEを指定するとその名前のCookieで判定する", async () => {
    process.env.SESSION_COOKIE_NAME = "gla-session";
    const event = makeEvent("/", { method: "GET", cookieName: "gla-session" });
    await run(event);
    expect(event.locals.user_id).toBe(1);
    const other = makeEvent("/", {
      method: "GET",
      cookieName: "__Host-gla-session",
    });
    const resolve = vi.fn(async () => new Response("resolved"));
    await expect(handle({ event: other, resolve })).rejects.toMatchObject({
      status: 302,
    });
  });
});
