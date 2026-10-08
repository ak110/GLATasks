import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("#lib/server/mcp/store.ts", () => ({
  getClient: vi.fn((id: string) =>
    id === "registered"
      ? {
          client_id: id,
          redirect_uris: ["https://client.example/callback"],
          client_secret: "secret",
        }
      : null,
  ),
  issueAuthorizationCode: vi.fn(() => "issued-code"),
  consumeAuthorizationCode: vi.fn(() => null),
  registerClient: vi.fn(),
}));
const { load, actions } =
  await import("../../../routes/oauth/authorize/+page.server");
const { POST: register } =
  await import("../../../routes/oauth/register/+server");
const { POST: token } = await import("../../../routes/oauth/token/+server");
const { issueAuthorizationCode } = await import("./store");

function event(params: Record<string, string> = {}, decision = "allow") {
  const query = new URLSearchParams({
    client_id: "registered",
    redirect_uri: "https://client.example/callback",
    response_type: "code",
    code_challenge: "a".repeat(43),
    code_challenge_method: "S256",
    state: "",
    ...params,
  });
  const url = new URL(`http://localhost/oauth/authorize?${query}`);
  return {
    url,
    locals: { user_id: 42 },
    request: new Request(url, {
      method: "POST",
      body: new URLSearchParams({ decision }),
    }),
  } as Parameters<typeof load>[0];
}

describe("OAuthの失敗応答", () => {
  beforeEach(() => vi.clearAllMocks());

  it("拒否と許可は登録した戻り先と空stateを保持する", async () => {
    for (const decision of ["deny", "allow"]) {
      try {
        await actions.default(event({}, decision));
        throw new Error("リダイレクトがありません");
      } catch (error) {
        expect(error).toMatchObject({ status: 302 });
        const location = new URL((error as { location: string }).location);
        expect(location.searchParams.has("state")).toBe(true);
        expect(location.searchParams.get("state")).toBe("");
        expect(
          location.searchParams.get(decision === "deny" ? "error" : "code"),
        ).toBe(decision === "deny" ? "access_denied" : "issued-code");
        if (decision === "deny")
          expect(issueAuthorizationCode).not.toHaveBeenCalled();
      }
    }
  });

  it("検証した戻り先へ要求不正の分類を返し、不一致の戻り先へは返さない", async () => {
    for (const [params, expected] of [
      [{ code_challenge: "" }, "invalid_request"],
      [{ response_type: "token" }, "unsupported_response_type"],
      [{ resource: "invalid" }, "invalid_target"],
    ] as const) {
      await expect(load(event(params))).rejects.toMatchObject({
        status: 302,
        location: `https://client.example/callback?error=${expected}&state=`,
      });
      await expect(actions.default(event(params))).rejects.toMatchObject({
        status: 302,
      });
    }
    expect(
      await load(
        event({ redirect_uri: "https://unregistered.example/callback" }),
      ),
    ).toMatchObject({ error: "invalid_redirect_uri", params: null });
  });

  it("本文の解析失敗とスキーマ不正の登録はAcceptによらずJSONを返す", async () => {
    for (const accept of ["application/json", "text/html"]) {
      for (const body of ["{invalid", '{"redirect_uris":[]}']) {
        const response = await register({
          request: new Request("http://localhost/oauth/register", {
            method: "POST",
            headers: { Accept: accept, "Content-Type": "application/json" },
            body,
          }),
        } as Parameters<typeof register>[0]);
        expect(response.status).toBe(400);
        expect(response.headers.get("Content-Type")).toContain(
          "application/json",
        );
        expect(await response.json()).toMatchObject({
          error: "invalid_client_metadata",
        });
      }
    }
  });

  it("Basicの解析・照合失敗は両grantで401と認証ヘッダーを返す", async () => {
    for (const credentials of [
      "!!!",
      btoa("%E:"),
      btoa("no-colon"),
      btoa("unknown:x"),
      btoa("registered:wrong"),
    ]) {
      for (const grant of ["authorization_code", "refresh_token"]) {
        const response = await token({
          request: new Request("http://localhost/oauth/token", {
            method: "POST",
            headers: { Authorization: `Basic ${credentials}` },
            body: new URLSearchParams({ grant_type: grant }),
          }),
        } as Parameters<typeof token>[0]);
        expect(response.status).toBe(401);
        expect(response.headers.get("WWW-Authenticate")).toBe("Basic");
        expect(await response.json()).toMatchObject({
          error: "invalid_client",
        });
      }
    }
  });
});
