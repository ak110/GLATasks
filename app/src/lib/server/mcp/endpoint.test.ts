import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { _resetProcessStateForTest } from "../process-state";

vi.mock("#lib/server/mcp/oauth.ts", () => ({
  verifyAccessToken: vi.fn(async () => ({
    userId: 42,
    clientId: "client",
    scope: "mcp",
    expiresAt: 1000,
  })),
}));

type Route = typeof import("../../../routes/mcp/+server");

/** 開発サーバーのモジュール再評価と同じく、ルートを新しい世代として読み込み直す。 */
async function loadRoute(): Promise<Route> {
  vi.resetModules();
  return import("../../../routes/mcp/+server");
}

const url = new URL("http://localhost/mcp");

function rpc(
  method: "POST" | "GET" | "DELETE",
  sessionId?: string,
  body?: unknown,
): Parameters<Route["POST"]>[0] {
  const headers: Record<string, string> = {
    Authorization: "Bearer token",
    Accept:
      method === "GET"
        ? "text/event-stream"
        : "application/json, text/event-stream",
  };
  if (sessionId) headers["mcp-session-id"] = sessionId;
  if (body !== undefined) headers["Content-Type"] = "application/json";
  const init: RequestInit = { method, headers };
  if (body !== undefined) init.body = JSON.stringify(body);
  const request = new Request(url, init);
  return { request, url } as Parameters<Route["POST"]>[0];
}

const initialize = {
  jsonrpc: "2.0",
  id: 1,
  method: "initialize",
  params: {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "test", version: "1.0.0" },
  },
};

const ping = (id: number) => ({ jsonrpc: "2.0", id, method: "ping" });

async function initializeSession(route: Route): Promise<string> {
  const response = await route.POST(rpc("POST", undefined, initialize));
  expect(response.status).toBe(200);
  await response.text();
  const sessionId = response.headers.get("mcp-session-id");
  expect(sessionId).toBeTruthy();
  const initialized = await route.POST(
    rpc("POST", sessionId!, {
      jsonrpc: "2.0",
      method: "notifications/initialized",
    }),
  );
  expect(initialized.status).toBe(202);
  return sessionId!;
}

// ルートの読み込み直しはMCPサーバーと業務操作の変換を伴い、初回は既定の5秒を超え得る。
describe("MCP sessionのHTTP応答", { timeout: 30_000 }, () => {
  beforeEach(() => _resetProcessStateForTest());
  afterEach(() => {
    vi.restoreAllMocks();
    _resetProcessStateForTest();
  });

  it("初期化を含むPOSTでも未知のsession IDは404を返す", async () => {
    const { POST } = await loadRoute();
    const response = await POST(rpc("POST", "unknown", initialize));
    expect(response.status).toBe(404);
  });

  it("再評価前に初期化したsessionへ、再評価後のPOST・GET・DELETEが届く", async () => {
    const before = await loadRoute();
    const sessionId = await initializeSession(before);

    const after = await loadRoute();
    const pinged = await after.POST(rpc("POST", sessionId, ping(2)));
    expect(pinged.status).toBe(200);
    expect(await pinged.text()).toContain('"id":2');

    const stream = await after.GET(rpc("GET", sessionId));
    expect(stream.status).toBe(200);
    expect(stream.headers.get("Content-Type")).toBe("text/event-stream");
    await stream.body?.cancel();

    const deleted = await after.DELETE(rpc("DELETE", sessionId));
    expect(deleted.status).toBe(200);

    // DELETEが同じtransportを終了したため、旧世代の処理からも到達できない
    const afterDelete = await before.POST(rpc("POST", sessionId, ping(3)));
    expect(afterDelete.status).toBe(404);
  });

  it("複数回評価しても回収周期は1本だけ作成される", async () => {
    const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
    await loadRoute();
    await loadRoute();
    await loadRoute();
    const cleanupTimers = setIntervalSpy.mock.calls.filter(
      ([, delay]) => delay === 60_000,
    );
    expect(cleanupTimers).toHaveLength(1);
  });
});
