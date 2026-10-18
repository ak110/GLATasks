import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetProcessStateForTest } from "../process-state";

type SessionsModule = typeof import("./sessions");

/** 開発サーバーのモジュール再評価と同じく、新しい世代として読み込み直す。 */
async function loadSessions(): Promise<SessionsModule> {
  vi.resetModules();
  return import("./sessions");
}

const { McpSessions } = await import("./sessions");

function transport(name: string, closed: string[]) {
  return {
    close: async () => {
      closed.push(name);
    },
  };
}

describe("MCP sessionの寿命", () => {
  it("要求で期限を延ばし、24時間無活動の接続だけを閉じる", async () => {
    let now = 0;
    const closed: string[] = [];
    const sessions = new McpSessions(new Map(), () => now);
    sessions.set("idle", transport("idle", closed));
    sessions.set("active", transport("active", closed));
    now = 23 * 60 * 60 * 1000;
    expect(sessions.get("active")).toBeDefined();
    now = 24 * 60 * 60 * 1000;
    await sessions.expire();
    expect(sessions.get("idle")).toBeUndefined();
    expect(closed).toEqual(["idle"]);
    expect(sessions.get("active")).toBeDefined();
    now += 24 * 60 * 60 * 1000;
    await sessions.expire();
    expect(closed).toEqual(["idle", "active"]);
  });
});

describe("MCP sessionの所有と回収周期", () => {
  beforeEach(() => {
    _resetProcessStateForTest();
    vi.useFakeTimers();
  });
  afterEach(() => {
    _resetProcessStateForTest();
    vi.useRealTimers();
  });

  it("再評価を重ねても周期は1本で、同じ表を共有し、無活動のtransportを閉じる", async () => {
    const closed: string[] = [];
    const first = (await loadSessions()).ownMcpSessions<
      ReturnType<typeof transport>
    >();
    first.sessions.set("idle", transport("idle", closed));
    const second = (await loadSessions()).ownMcpSessions<
      ReturnType<typeof transport>
    >();
    const third = (await loadSessions()).ownMcpSessions<
      ReturnType<typeof transport>
    >();
    expect(vi.getTimerCount()).toBe(1);
    expect(third.sessions.get("idle")).toBeDefined();

    second.sessions.set("active", transport("active", closed));
    await vi.advanceTimersByTimeAsync(23 * 60 * 60 * 1000);
    expect(third.sessions.get("active")).toBeDefined();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000 + 60_000);
    expect(closed).toEqual(["idle"]);
    expect(first.sessions.get("idle")).toBeUndefined();
    expect(first.sessions.get("active")).toBeDefined();
  });

  it("明示停止は周期を取り消し、保持中のtransportを閉じる", async () => {
    const closed: string[] = [];
    const owner = (await loadSessions()).ownMcpSessions<
      ReturnType<typeof transport>
    >();
    owner.sessions.set("a", transport("a", closed));
    owner.sessions.set("b", transport("b", closed));
    const latest = (await loadSessions()).ownMcpSessions<
      ReturnType<typeof transport>
    >();
    await latest.stop();
    expect(closed).toEqual(["a", "b"]);
    expect(vi.getTimerCount()).toBe(0);
    expect(owner.sessions.get("a")).toBeUndefined();
  });
});
