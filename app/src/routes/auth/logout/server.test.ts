import { afterEach, describe, expect, it, vi } from "vitest";
import { POST } from "./+server";

type LogoutEvent = Parameters<typeof POST>[0];

describe("ログアウト", () => {
  afterEach(() => {
    delete process.env.SESSION_COOKIE_NAME;
  });

  it.each([
    [undefined, "__Host-gla-session"],
    ["gla-session", "gla-session"],
  ])(
    "SESSION_COOKIE_NAME=%sでは%sのCookieを削除する",
    async (configured, expected) => {
      if (configured !== undefined)
        process.env.SESSION_COOKIE_NAME = configured;
      const del = vi.fn();
      await expect(
        POST({ cookies: { delete: del } } as unknown as LogoutEvent),
      ).rejects.toMatchObject({ status: 302, location: "/auth/login" });
      // `__Host-`のCookieは非Secureの削除が無視されるため、発行時と同じ属性で削除する
      expect(del).toHaveBeenCalledWith(expected, {
        path: "/",
        httpOnly: true,
        secure: true,
        sameSite: "none",
      });
    },
  );
});
