/**
 * @fileoverview セッションの用途検証とCookie設定のテスト
 */

import { SignJWT } from "jose";
import { describe, expect, it, vi } from "vitest";
import {
  createSessionToken,
  setSessionCookie,
  verifySessionToken,
} from "./session";
import { createAccessToken, createRefreshToken } from "./mcp/oauth";

// 鍵管理は外部境界として差し替え、実際のJWT発行・検証を通す。
vi.mock("./env", () => ({
  getJwtSecret: () => Buffer.alloc(32, 1).toString("base64"),
}));

describe("セッションの用途検証", () => {
  it("新旧セッションを受理し、MCPと未知用途のJWTを拒否する", async () => {
    const key = new Uint8Array(32).fill(1);
    const legacy = await new SignJWT({ sub: "123" })
      .setProtectedHeader({ alg: "HS256" })
      .setExpirationTime("1h")
      .sign(key);
    expect(await verifySessionToken(legacy)).toBe(123);
    expect(await verifySessionToken(await createSessionToken(123))).toBe(123);

    const params = { userId: 123, clientId: "session-test", scope: "mcp" };
    for (const token of [
      await createAccessToken(params),
      await createRefreshToken(params),
      await new SignJWT({ sub: "123" })
        .setProtectedHeader({ alg: "HS256" })
        .setAudience("another-service")
        .setExpirationTime("1h")
        .sign(key),
      await new SignJWT({ sub: "123" })
        .setProtectedHeader({ alg: "HS256" })
        .setAudience(["glatasks-session", "another-service"])
        .setExpirationTime("1h")
        .sign(key),
    ]) {
      expect(await verifySessionToken(token)).toBeNull();
    }
  });

  it("期限切れと別の鍵によるJWTを拒否する", async () => {
    for (const [key, expiration] of [
      [new Uint8Array(32).fill(1), 1],
      [new Uint8Array(32).fill(2), "1h"],
    ] as const) {
      const token = await new SignJWT({ sub: "123" })
        .setProtectedHeader({ alg: "HS256" })
        .setAudience("glatasks-session")
        .setExpirationTime(expiration)
        .sign(key);
      expect(await verifySessionToken(token)).toBeNull();
    }
  });
});

describe("setSessionCookie", () => {
  it("正しいオプションで Cookie をセットする", () => {
    const set = vi.fn();
    const cookies = { set } as never;

    setSessionCookie(cookies, "test-token-123");

    expect(set).toHaveBeenCalledOnce();
    expect(set).toHaveBeenCalledWith("gla-session", "test-token-123", {
      path: "/",
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 365 * 24 * 60 * 60,
    });
  });
});
