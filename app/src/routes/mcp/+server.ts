/**
 * @fileoverview MCP Streamable HTTP エンドポイント
 *
 * POST: JSON-RPC リクエスト受信。SSE ストリームまたは JSON で応答する。
 * GET: ステートフルセッション向けの GET SSE ストリーム。
 * DELETE: セッション終了。
 *
 * Bearer 認証必須。失敗時は WWW-Authenticate ヘッダーで Protected Resource Metadata を案内する。
 */

import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import crypto from "node:crypto";
import { createMcpServer } from "$lib/server/mcp/server";
import { verifyAccessToken } from "$lib/server/mcp/oauth";
import type { RequestHandler } from "./$types";

/**
 * セッションごとの transport を保持する。
 * Streamable HTTP のステートフルモードでは初期化リクエストで session id を発行し、
 * 後続リクエストは同じ transport インスタンスへルーティングする。
 */
const sessions = new Map<string, WebStandardStreamableHTTPServerTransport>();

function unauthorized(originUrl: URL): Response {
  const metadataUrl = `${originUrl.origin}/.well-known/oauth-protected-resource`;
  return new Response(
    JSON.stringify({
      error: "invalid_token",
      error_description: "valid Bearer token required",
    }),
    {
      status: 401,
      headers: {
        "Content-Type": "application/json",
        "WWW-Authenticate": `Bearer realm="glatasks-mcp", resource_metadata="${metadataUrl}"`,
      },
    },
  );
}

async function authenticate(
  request: Request,
  url: URL,
): Promise<AuthInfo | Response> {
  const authHeader = request.headers.get("authorization");
  if (!authHeader?.toLowerCase().startsWith("bearer ")) {
    return unauthorized(url);
  }
  const token = authHeader.slice(7).trim();
  const payload = await verifyAccessToken(token);
  if (!payload) return unauthorized(url);
  return {
    token,
    clientId: payload.clientId,
    scopes: payload.scope ? payload.scope.split(/\s+/) : [],
    expiresAt: payload.expiresAt,
    extra: { userId: payload.userId },
  };
}

async function getOrCreateTransport(
  sessionId: string | undefined,
  isInitialize: boolean,
): Promise<WebStandardStreamableHTTPServerTransport | null> {
  if (sessionId && sessions.has(sessionId)) {
    return sessions.get(sessionId)!;
  }
  if (!isInitialize) return null;
  const transport: WebStandardStreamableHTTPServerTransport =
    new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: () => crypto.randomUUID(),
      onsessioninitialized: (id: string) => {
        sessions.set(id, transport);
      },
      onsessionclosed: (id: string) => {
        sessions.delete(id);
      },
    });
  const server = createMcpServer();
  await server.connect(transport);
  return transport;
}

export const POST: RequestHandler = async ({ request, url }) => {
  const auth = await authenticate(request, url);
  if (auth instanceof Response) return auth;

  const body = await request
    .clone()
    .json()
    .catch(() => null);
  const isInitialize = Array.isArray(body)
    ? body.some((m) => typeof m === "object" && m && m.method === "initialize")
    : typeof body === "object" && body && body.method === "initialize";

  const sessionId = request.headers.get("mcp-session-id") ?? undefined;
  const transport = await getOrCreateTransport(sessionId, isInitialize);
  if (!transport) {
    return new Response(
      JSON.stringify({
        error: "invalid_session",
        error_description: "unknown session",
      }),
      { status: 400, headers: { "Content-Type": "application/json" } },
    );
  }
  return transport.handleRequest(request, { authInfo: auth, parsedBody: body });
};

export const GET: RequestHandler = async ({ request, url }) => {
  const auth = await authenticate(request, url);
  if (auth instanceof Response) return auth;
  const sessionId = request.headers.get("mcp-session-id") ?? undefined;
  const transport = sessionId ? sessions.get(sessionId) : undefined;
  if (!transport) {
    return new Response("session not found", { status: 404 });
  }
  return transport.handleRequest(request, { authInfo: auth });
};

export const DELETE: RequestHandler = async ({ request, url }) => {
  const auth = await authenticate(request, url);
  if (auth instanceof Response) return auth;
  const sessionId = request.headers.get("mcp-session-id") ?? undefined;
  const transport = sessionId ? sessions.get(sessionId) : undefined;
  if (!transport) {
    return new Response(null, { status: 204 });
  }
  return transport.handleRequest(request, { authInfo: auth });
};
