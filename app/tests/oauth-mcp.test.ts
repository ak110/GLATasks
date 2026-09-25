/** @fileoverview OAuth登録からMCP認証付き要求までをHTTPと画面入口で確認する。 */

import { createHash, randomBytes } from "node:crypto";
import { expect, test } from "@playwright/test";

test("OAuth登録から認可とトークン交換を経てMCPへ接続できる", async ({
  page,
}) => {
  const unauthenticated = await page.request.post("/mcp", { data: {} });
  expect(unauthenticated.status()).toBe(401);
  expect(unauthenticated.headers()["www-authenticate"]).toContain(
    "/.well-known/oauth-protected-resource",
  );

  const protectedMetadata = await page.request.get(
    "/.well-known/oauth-protected-resource",
  );
  expect(protectedMetadata.ok()).toBe(true);
  const resource: string = (await protectedMetadata.json()).resource;
  expect(new URL(resource).pathname).toBe("/mcp");

  const authorizationMetadata = await page.request.get(
    "/.well-known/oauth-authorization-server",
  );
  expect(authorizationMetadata.ok()).toBe(true);
  const metadata = await authorizationMetadata.json();
  expect(new URL(metadata.authorization_endpoint).pathname).toBe(
    "/oauth/authorize",
  );
  expect(new URL(metadata.token_endpoint).pathname).toBe("/oauth/token");
  expect(new URL(metadata.registration_endpoint).pathname).toBe(
    "/oauth/register",
  );

  const redirectUri = "https://client.example/callback";
  const registration = await page.request.post("/oauth/register", {
    data: {
      redirect_uris: [redirectUri],
      token_endpoint_auth_method: "none",
      client_name: "E2E MCP client",
      scope: "mcp",
    },
  });
  expect(registration.status()).toBe(201);
  const { client_id: clientId } = await registration.json();
  expect(clientId).toBeTruthy();

  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const query = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "mcp",
    state: "e2e-state",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource,
  });
  await page.goto(`/oauth/authorize?${query}`);
  await expect(
    page.getByRole("heading", { name: "アクセスを許可しますか" }),
  ).toBeVisible();
  await expect(page.getByText("E2E MCP client")).toBeVisible();
  const consent = await page.request.post(`/oauth/authorize?${query}`, {
    form: {},
    maxRedirects: 0,
  });
  expect(consent.ok()).toBe(true);
  const action = await consent.json();
  expect(action.type).toBe("redirect");
  expect(action.status).toBe(302);
  const callback = new URL(action.location);
  expect(callback.searchParams.get("state")).toBe("e2e-state");
  const code = callback.searchParams.get("code");
  expect(code).toBeTruthy();

  const tokenResponse = await page.request.post("/oauth/token", {
    form: {
      grant_type: "authorization_code",
      code: code!,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      client_id: clientId,
    },
  });
  expect(tokenResponse.ok()).toBe(true);
  const token = await tokenResponse.json();
  expect(token.token_type).toBe("Bearer");
  expect(token.access_token).toBeTruthy();

  const initialized = await page.request.post("/mcp", {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      Accept: "application/json, text/event-stream",
      "Content-Type": "application/json",
    },
    data: {
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "e2e-client", version: "1.0" },
      },
    },
  });
  expect(initialized.ok()).toBe(true);
  expect(await initialized.text()).toContain("result");
});
