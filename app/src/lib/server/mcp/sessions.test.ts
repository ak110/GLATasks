import { describe, expect, it } from "vitest";
import { McpSessions } from "./sessions";

describe("MCP sessionの寿命", () => {
  it("要求で期限を延ばし、24時間無活動の接続だけを閉じる", async () => {
    let now = 0;
    const closed: string[] = [];
    const sessions = new McpSessions(() => now);
    sessions.set("idle", {
      close: async () => {
        closed.push("idle");
      },
    });
    sessions.set("active", {
      close: async () => {
        closed.push("active");
      },
    });
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
