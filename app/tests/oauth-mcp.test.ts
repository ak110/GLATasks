/** @fileoverview OAuth登録からMCP認証付き要求までをHTTPと画面入口で確認する。 */

import { createHash, randomBytes } from "node:crypto";
import { expect, test, type APIRequestContext } from "@playwright/test";
import { BASE_URL } from "./helpers/common";

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
    form: { decision: "allow" },
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

async function authorizationRequest(
  request: APIRequestContext,
  redirectUri = "https://client.example/callback",
) {
  const response = await request.post("/oauth/register", {
    data: { redirect_uris: [redirectUri], token_endpoint_auth_method: "none" },
  });
  expect(response.status()).toBe(201);
  const { client_id: clientId } = await response.json();
  return new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    code_challenge: "a".repeat(43),
    code_challenge_method: "S256",
    state: "拒否と失敗のstate",
  });
}

test("OAuth認可の拒否は登録した戻り先へstateとaccess_deniedを返す", async ({
  page,
}) => {
  // HTTPリダイレクトの後続要求はrouteで捕捉されないため、実在する戻り先を登録する。
  const redirectUri = new URL("/?oauth-callback=e2e", BASE_URL);
  const query = await authorizationRequest(page.request, redirectUri.href);
  await page.goto(`/oauth/authorize?${query}`);
  await page.getByTestId("oauth-deny").click();
  await page.waitForURL(
    (url) =>
      url.origin === redirectUri.origin &&
      url.pathname === redirectUri.pathname &&
      url.searchParams.get("oauth-callback") === "e2e" &&
      url.searchParams.get("error") === "access_denied",
  );
  const callback = new URL(page.url());
  expect(callback.origin).toBe(redirectUri.origin);
  expect(callback.pathname).toBe(redirectUri.pathname);
  expect(callback.searchParams.get("error")).toBe("access_denied");
  expect(callback.searchParams.get("state")).toBe(query.get("state"));
  expect(callback.searchParams.has("code")).toBe(false);
});

test("OAuth認可の入力不正は検証済み戻り先へ分類とstateを返す", async ({
  page,
}) => {
  const query = await authorizationRequest(page.request);
  const cases: Array<[string, string | undefined, string]> = [
    ["code_challenge", undefined, "invalid_request"],
    ["code_challenge", "short", "invalid_request"],
    ["code_challenge_method", undefined, "invalid_request"],
    ["code_challenge_method", "plain", "invalid_request"],
    ["response_type", undefined, "invalid_request"],
    ["response_type", "token", "unsupported_response_type"],
    ["resource", "invalid-url", "invalid_target"],
  ];
  for (const [name, value, error] of cases) {
    const invalid = new URLSearchParams(query);
    if (value === undefined) invalid.delete(name);
    else invalid.set(name, value);
    for (const method of ["get", "post"] as const) {
      const response =
        method === "get"
          ? await page.request.get(`/oauth/authorize?${invalid}`, {
              maxRedirects: 0,
            })
          : await page.request.post(`/oauth/authorize?${invalid}`, {
              form: { decision: "allow" },
              maxRedirects: 0,
            });
      const location =
        method === "get"
          ? response.headers().location
          : (await response.json()).location;
      const callback = new URL(location);
      expect(callback.searchParams.get("error"), `${method} ${name}`).toBe(
        error,
      );
      expect(callback.searchParams.get("state")).toBe(query.get("state"));
      expect(callback.searchParams.has("code")).toBe(false);
    }
  }
  const invalid = new URLSearchParams(query);
  invalid.set("redirect_uri", "https://unregistered.example/callback");
  await page.goto(`/oauth/authorize?${invalid}`);
  await expect(
    page.getByRole("heading", { name: "認可リクエストエラー" }),
  ).toBeVisible();
  expect(new URL(page.url()).pathname).toBe("/oauth/authorize");
});

test("OAuth登録は本文の解析失敗とスキーマ不正をJSONのinvalid_client_metadataで返す", async ({
  page,
}) => {
  for (const accept of ["application/json", "text/html"]) {
    for (const data of ["{not json", '{"redirect_uris":[]}']) {
      const response = await page.request.post("/oauth/register", {
        headers: { Accept: accept, "Content-Type": "application/json" },
        data,
      });
      expect(response.status()).toBe(400);
      expect(response.headers()["content-type"]).toContain("application/json");
      expect((await response.json()).error).toBe("invalid_client_metadata");
    }
  }
});

test("OAuthトークンのBasic認証失敗は401とWWW-Authenticateを返す", async ({
  page,
}) => {
  for (const credentials of [
    "!!!",
    Buffer.from("%E:").toString("base64"),
    Buffer.from("missing-colon").toString("base64"),
    Buffer.from("unknown:y").toString("base64"),
  ]) {
    for (const grantType of ["authorization_code", "refresh_token"]) {
      const response = await page.request.post("/oauth/token", {
        headers: { Authorization: `Basic ${credentials}` },
        form: { grant_type: grantType },
      });
      expect(response.status()).toBe(401);
      expect((await response.json()).error).toBe("invalid_client");
      expect(response.headers()["www-authenticate"]).toBe("Basic");
    }
  }
});
