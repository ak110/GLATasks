/**
 * @fileoverview 開発サーバーのモジュール再評価をまたいだOAuth認可コードの発行と消費の試験
 *
 * 認可コードは発行から消費まで短時間だけプロセス内に保持する。発行した世代と消費する
 * トークンエンドポイントの世代が異なっても、既存の期限・一度だけの消費・クライアントと
 * 戻り先とPKCEの検証に従うことを確かめる。
 */

import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { _resetProcessStateForTest } from "../process-state";

type Store = typeof import("./store");
type TokenRoute = typeof import("../../../routes/oauth/token/+server");

const REDIRECT_URI = "https://client.example/callback";
const VERIFIER = "v".repeat(43);
const CHALLENGE = createHash("sha256").update(VERIFIER).digest("base64url");

let dataDir: string;
const savedEnv = { ...process.env };

/** 開発サーバーのモジュール再評価と同じく、新しい世代として読み込み直す。 */
async function loadStore(): Promise<Store> {
  vi.resetModules();
  return import("./store");
}

async function loadTokenRoute(): Promise<TokenRoute> {
  vi.resetModules();
  return import("../../../routes/oauth/token/+server");
}

function registerPublicClient(store: Store): string {
  return store.registerClient({
    redirect_uris: [REDIRECT_URI],
    token_endpoint_auth_method: "none",
    grant_types: ["authorization_code"],
    response_types: ["code"],
  }).client_id;
}

function issue(store: Store, clientId: string): string {
  return store.issueAuthorizationCode({
    client_id: clientId,
    redirect_uri: REDIRECT_URI,
    user_id: 42,
    scope: "mcp",
    code_challenge: CHALLENGE,
    code_challenge_method: "S256",
  });
}

async function exchange(
  route: TokenRoute,
  params: Record<string, string>,
): Promise<Response> {
  const request = new Request("http://localhost/oauth/token", {
    method: "POST",
    body: new URLSearchParams({
      grant_type: "authorization_code",
      redirect_uri: REDIRECT_URI,
      code_verifier: VERIFIER,
      ...params,
    }),
  });
  return route.POST({ request } as Parameters<TokenRoute["POST"]>[0]);
}

beforeAll(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "glatasks-oauth-"));
  process.env.DATA_DIR = dataDir;
  process.env.DATABASE_URL ??= "mysql://test:test@localhost/test";
});

afterAll(() => {
  process.env = savedEnv;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe(
  "認可コードのモジュール再評価をまたぐ消費",
  { timeout: 30_000 },
  () => {
    beforeEach(() => _resetProcessStateForTest());
    afterEach(() => {
      vi.useRealTimers();
      _resetProcessStateForTest();
    });

    it("再評価前に発行した未失効のコードを再評価後に一度だけ消費できる", async () => {
      const before = await loadStore();
      const clientId = registerPublicClient(before);
      const code = issue(before, clientId);

      const route = await loadTokenRoute();
      const granted = await exchange(route, { code, client_id: clientId });
      expect(granted.status).toBe(200);
      expect(await granted.json()).toMatchObject({
        token_type: "Bearer",
        scope: "mcp",
      });

      const reused = await exchange(route, { code, client_id: clientId });
      expect(reused.status).toBe(400);
      expect(await reused.json()).toMatchObject({ error: "invalid_grant" });
    });

    it("再評価後も期限切れ・クライアント・戻り先・PKCEの不一致を拒否する", async () => {
      vi.useFakeTimers({ toFake: ["Date"] });
      vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
      const before = await loadStore();
      const clientId = registerPublicClient(before);
      const otherClientId = registerPublicClient(before);
      const expiredCode = issue(before, clientId);
      const cases: Record<string, string>[] = [
        { code: issue(before, clientId), client_id: otherClientId },
        {
          code: issue(before, clientId),
          client_id: clientId,
          redirect_uri: "https://client.example/other",
        },
        {
          code: issue(before, clientId),
          client_id: clientId,
          code_verifier: "w".repeat(43),
        },
      ];

      const route = await loadTokenRoute();
      for (const params of cases) {
        const response = await exchange(route, params);
        expect(response.status).toBe(400);
        expect(await response.json()).toMatchObject({ error: "invalid_grant" });
      }

      vi.setSystemTime(new Date("2026-01-01T00:10:01Z"));
      const expired = await exchange(route, {
        code: expiredCode,
        client_id: clientId,
      });
      expect(expired.status).toBe(400);
      expect(await expired.json()).toMatchObject({ error: "invalid_grant" });
    });
  },
);
