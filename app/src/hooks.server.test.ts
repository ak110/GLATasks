import type { Handle } from "@sveltejs/kit/hooks";
import { describe, expect, it, vi } from "vitest";
vi.mock("$app/env", () => ({ building: false }));

vi.mock("#lib/server/scheduler.ts", () => ({ startScheduler: vi.fn() }));
vi.mock("#lib/server/session.ts", () => ({
  verifySessionToken: vi.fn(async () => null),
}));
const { handle } = await import("./hooks.server");

describe("セッション認証の入口", () => {
  it("未ログインの共有POSTはactionへ到達せずログインへ戻る", async () => {
    const event = {
      request: new Request("http://localhost/share/ingest", { method: "POST" }),
      url: new URL("http://localhost/share/ingest"),
      cookies: { get: () => undefined },
      locals: {},
    } as unknown as Parameters<Handle>[0]["event"];
    const resolve = vi.fn(async () => new Response("action"));
    await expect(handle({ event, resolve })).rejects.toMatchObject({
      status: 302,
      location: "/auth/login",
    });
    expect(resolve).not.toHaveBeenCalled();
  });
});
