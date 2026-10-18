import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

// 更新トークンの検証は署名鍵をDATA_DIRへ作成する。make test-dbのようにDATABASE_URLがある実行で
// 作業ツリーの既定の保存先へ書かないよう、ルートを読み込む前に一時ディレクトリを指定する
const dataDir = fs.mkdtempSync(
  path.join(os.tmpdir(), "glatasks-oauth-endpoints-"),
);
const savedDataDir = process.env.DATA_DIR;
process.env.DATA_DIR = dataDir;
afterAll(() => {
  if (savedDataDir === undefined) delete process.env.DATA_DIR;
  else process.env.DATA_DIR = savedDataDir;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

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

/**
 * `error_description`が理由と次の操作の2文を持ち、RFC 6749 5.2の文字種に収まることを確かめる。
 * 次の操作は動詞で始まる2文目以降として現れる。
 */
function expectDescriptionWithNextAction(description: unknown) {
  expect(typeof description).toBe("string");
  const text = description as string;
  expect(text).toMatch(/^[\x20-\x21\x23-\x5B\x5D-\x7E]+$/);
  const sentences = text.split(/(?<=\.) /);
  expect(sentences.length).toBeGreaterThanOrEqual(2);
  expect(sentences.slice(1).join(" ")).toMatch(
    /\b(Send|Restart|Register|Exchange|To connect again)\b/,
  );
}

async function expectTokenFailure(response: Response, error: string) {
  const body = await response.json();
  expect(body).toMatchObject({ error });
  expectDescriptionWithNextAction(body.error_description);
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
        if (decision === "deny") {
          expect(issueAuthorizationCode).not.toHaveBeenCalled();
          expectDescriptionWithNextAction(
            location.searchParams.get("error_description"),
          );
        } else {
          expect(location.searchParams.has("error_description")).toBe(false);
        }
      }
    }
  });

  it("検証した戻り先へ要求不正の分類を返し、不一致の戻り先へは返さない", async () => {
    for (const [params, expected] of [
      [{ code_challenge: "" }, "invalid_request"],
      [{ response_type: "token" }, "unsupported_response_type"],
      [{ resource: "invalid" }, "invalid_target"],
    ] as const) {
      const redirected = await Promise.resolve(load(event(params))).then(
        () => {
          throw new Error("リダイレクトがありません");
        },
        (error: { status: number; location: string }) => error,
      );
      expect(redirected.status).toBe(302);
      const location = new URL(redirected.location);
      expect(`${location.origin}${location.pathname}`).toBe(
        "https://client.example/callback",
      );
      expect(location.searchParams.get("error")).toBe(expected);
      expect(location.searchParams.get("state")).toBe("");
      expectDescriptionWithNextAction(
        location.searchParams.get("error_description"),
      );
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
        await expectTokenFailure(response, "invalid_client_metadata");
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
        await expectTokenFailure(response, "invalid_client");
      }
    }
  });

  it("トークンエンドポイントの要求不正と照合失敗は全てerror_descriptionに次の操作を持つ", async () => {
    const post = (body: BodyInit, headers: Record<string, string> = {}) =>
      Promise.resolve(
        token({
          request: new Request("http://localhost/oauth/token", {
            method: "POST",
            headers,
            body,
          }),
        } as Parameters<typeof token>[0]),
      );
    const basic = { Authorization: `Basic ${btoa("registered:secret")}` };
    const cases: [Promise<Response>, number, string][] = [
      [
        post("not a form", { "Content-Type": "multipart/form-data" }),
        400,
        "invalid_request",
      ],
      [
        post(new URLSearchParams({ grant_type: "password" })),
        400,
        "unsupported_grant_type",
      ],
      [
        post(new URLSearchParams({ grant_type: "authorization_code" })),
        400,
        "invalid_client",
      ],
      [
        post(new URLSearchParams({ grant_type: "authorization_code" }), basic),
        400,
        "invalid_request",
      ],
      [
        post(
          new URLSearchParams({
            grant_type: "authorization_code",
            code: "unknown",
            redirect_uri: "https://client.example/callback",
            code_verifier: "v".repeat(43),
          }),
          basic,
        ),
        400,
        "invalid_grant",
      ],
      [
        post(new URLSearchParams({ grant_type: "refresh_token" }), basic),
        400,
        "invalid_request",
      ],
      [
        post(
          new URLSearchParams({
            grant_type: "refresh_token",
            refresh_token: "x",
          }),
          basic,
        ),
        400,
        "invalid_grant",
      ],
    ];
    for (const [pending, status, error] of cases) {
      const response = await pending;
      expect(response.status, error).toBe(status);
      await expectTokenFailure(response, error);
    }
  });
});
