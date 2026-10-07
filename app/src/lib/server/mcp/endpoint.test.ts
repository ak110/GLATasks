import type { RequestEvent } from "@sveltejs/kit";
import { describe, expect, it, vi } from "vitest";

vi.mock("#lib/server/mcp/oauth.ts", () => ({
  verifyAccessToken: vi.fn(async () => ({
    userId: 42,
    clientId: "client",
    scope: "mcp",
    expiresAt: 1000,
  })),
}));
const { POST } = await import("../../../routes/mcp/+server");

describe("MCP sessionのHTTP応答", () => {
  it("初期化を含むPOSTでも未知のsession IDは404を返す", async () => {
    const url = new URL("http://localhost/mcp");
    const request = new Request(url, {
      method: "POST",
      headers: {
        Authorization: "Bearer token",
        "mcp-session-id": "unknown",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {},
      }),
    });
    const response = await POST({ request, url } as RequestEvent);
    expect(response.status).toBe(404);
  });
});
