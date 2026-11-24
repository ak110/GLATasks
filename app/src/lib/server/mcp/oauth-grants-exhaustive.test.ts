import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

type Store = typeof import("./store");
type OAuth = typeof import("./oauth");
type TokenRoute = typeof import("../../../routes/oauth/token/+server");

const T0 = Date.UTC(2026, 0, 1, 0, 0, 0);
const CODE_TTL_MS = 600_000;
const ACCESS_TTL_MS = 3_600_000;
const REFRESH_TTL_MS = 30 * 24 * 3_600_000;
const MAX_REPORTED = 20;

interface Client {
  id: string;
  redirect: string;
  secret?: string;
}

interface Identity {
  label: string;
  clientId: string;
  secret?: string;
  authenticated: boolean;
}

interface CodeSpec {
  label: string;
  userId: number;
  client: Client;
  scope: string;
  verifier: string;
}

interface ExchangeInput {
  identity: Identity;
  redirect: string;
  redirectLabel: string;
  verifier: string;
  verifierLabel: string;
  at: number;
}

interface Grant {
  userId: number;
  clientId: string;
  scope: string;
}

let dataDir: string;
let store: Store;
let oauth: OAuth;
let route: TokenRoute;
const savedEnv = { ...process.env };

let c1: Client;
let c2: Client;
let identities: Identity[];
let codeSpecs: CodeSpec[];

function challengeOf(verifier: string): string {
  return createHash("sha256").update(verifier).digest("base64url");
}

function post(identity: Identity, params: Record<string, string>) {
  const body = new URLSearchParams({ client_id: identity.clientId, ...params });
  if (identity.secret !== undefined) body.set("client_secret", identity.secret);
  const request = new Request("http://localhost/oauth/token", {
    method: "POST",
    body,
  });
  return route.POST({ request } as Parameters<TokenRoute["POST"]>[0]);
}

function issue(spec: CodeSpec): string {
  vi.setSystemTime(T0);
  return store.issueAuthorizationCode({
    client_id: spec.client.id,
    redirect_uri: spec.client.redirect,
    user_id: spec.userId,
    scope: spec.scope,
    code_challenge: challengeOf(spec.verifier),
    code_challenge_method: "S256",
  });
}

function exchangeInputs(spec: CodeSpec, other: CodeSpec): ExchangeInput[] {
  const inputs: ExchangeInput[] = [];
  const otherRedirect = spec.client === c1 ? c2.redirect : c1.redirect;
  for (const identity of identities)
    for (const [redirect, redirectLabel] of [
      [spec.client.redirect, "発行時の戻り先"],
      [otherRedirect, "他クライアントの戻り先"],
    ])
      for (const [verifier, verifierLabel] of [
        [spec.verifier, "正しいverifier"],
        [other.verifier, "他コードのverifier"],
      ])
        for (const at of [T0 + 1_000, T0 + CODE_TTL_MS, T0 + CODE_TTL_MS + 1])
          inputs.push({
            identity,
            redirect,
            redirectLabel,
            verifier,
            verifierLabel,
            at,
          });
  return inputs;
}

function describeInput(input: ExchangeInput): string {
  return `${input.identity.label}・${input.redirectLabel}・${input.verifierLabel}・T0+${input.at - T0}ms`;
}

function grantOf(spec: CodeSpec): Grant {
  return { userId: spec.userId, clientId: spec.client.id, scope: spec.scope };
}

function expectedExchange(
  spec: CodeSpec,
  input: ExchangeInput,
  consumed: boolean,
): { granted: boolean; consumes: boolean } {
  if (!input.identity.authenticated) return { granted: false, consumes: false };
  const granted =
    !consumed &&
    input.at - T0 <= CODE_TTL_MS &&
    input.identity.clientId === spec.client.id &&
    input.redirect === spec.client.redirect &&
    input.verifier === spec.verifier;
  return { granted, consumes: true };
}

function inspectDecision(expected: boolean, status: number): string[] {
  if (expected && status !== 200) return [`拒否された（${status}）`];
  if (!expected && status === 200) return ["条件外で成功した"];
  return [];
}

async function inspectGrantResponse(
  response: Response,
  expected: Grant,
  needRefresh: boolean,
): Promise<string[]> {
  const problems: string[] = [];
  const body = await response.json();
  if (body.scope !== expected.scope)
    problems.push(`応答のscopeが${JSON.stringify(body.scope)}`);
  const access = await oauth.verifyAccessToken(body.access_token);
  if (
    !access ||
    access.userId !== expected.userId ||
    access.clientId !== expected.clientId ||
    access.scope !== expected.scope
  )
    problems.push(`アクセストークンの内容が${JSON.stringify(access)}`);
  if (needRefresh) {
    const refresh = await oauth.verifyRefreshToken(body.refresh_token);
    if (
      !refresh ||
      refresh.userId !== expected.userId ||
      refresh.clientId !== expected.clientId ||
      refresh.scope !== expected.scope
    )
      problems.push(`更新トークンの内容が${JSON.stringify(refresh)}`);
  }
  return problems;
}

async function inspectRejection(response: Response): Promise<string[]> {
  if (response.status !== 400 && response.status !== 401)
    return [`拒否のはずがstatus ${response.status}`];
  const body = await response.json();
  return "access_token" in body ? ["拒否の応答にaccess_tokenがある"] : [];
}

beforeAll(async () => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "glatasks-oauth-grants-"));
  process.env.DATA_DIR = dataDir;
  process.env.DATABASE_URL ??= "mysql://test:test@localhost/test";
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(T0);
  store = await import("./store");
  oauth = await import("./oauth");
  route = await import("../../../routes/oauth/token/+server");
  const register = (redirect: string, secret?: string): Client => {
    const registered = store.registerClient({
      redirect_uris: [redirect],
      token_endpoint_auth_method: secret ? "client_secret_post" : "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      ...(secret ? { client_secret: secret } : {}),
    });
    return { id: registered.client_id, redirect, secret };
  };
  c1 = register("https://c1.example/callback");
  c2 = register("https://c2.example/callback", "c2-secret");
  identities = [
    { label: "C1", clientId: c1.id, authenticated: true },
    {
      label: "C2(正しい秘密)",
      clientId: c2.id,
      secret: "c2-secret",
      authenticated: true,
    },
    {
      label: "C2(誤った秘密)",
      clientId: c2.id,
      secret: "wrong-secret",
      authenticated: false,
    },
  ];
  codeSpecs = [];
  for (const [userId, scope] of [
    [1, "mcp"],
    [2, "mcp tasks:read"],
  ] as const)
    for (const client of [c1, c2])
      codeSpecs.push({
        label: `U${userId}→${client === c1 ? "C1" : "C2"}`,
        userId,
        client,
        scope,
        verifier: `${userId}-${client === c1 ? "c1" : "c2"}-`.padEnd(43, "v"),
      });
});

afterAll(() => {
  vi.useRealTimers();
  process.env = savedEnv;
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe(
  "OAuthの認可コードと更新トークンの有界網羅検査",
  { timeout: 120_000 },
  () => {
    it.each([
      ["条件外の許可", false, 200, ["条件外で成功した"]],
      ["正当な要求の拒否", true, 400, ["拒否された（400）"]],
      ["条件外の要求の拒否", false, 400, []],
      ["正当な要求の許可", true, 200, []],
    ] as const)("合成判定: %s", (_label, expected, status, violations) => {
      expect(inspectDecision(expected, status)).toEqual(violations);
    });

    it("同じコードへの2要求の全ての順序で、条件を満たす最初の1回だけが発行時の権限で成功する", async () => {
      const failures: string[] = [];
      let sequences = 0;
      for (const [index, spec] of codeSpecs.entries()) {
        const other = codeSpecs[(index + 1) % codeSpecs.length];
        const inputs = exchangeInputs(spec, other);
        for (const first of inputs)
          for (const second of inputs) {
            if (second.at < first.at) continue;
            sequences++;
            const code = issue(spec);
            let consumed = false;
            const problems: string[] = [];
            for (const [step, input] of [first, second].entries()) {
              const expected = expectedExchange(spec, input, consumed);
              if (expected.consumes) consumed = true;
              vi.setSystemTime(input.at);
              const response = await post(input.identity, {
                grant_type: "authorization_code",
                code,
                redirect_uri: input.redirect,
                code_verifier: input.verifier,
              });
              const decision = inspectDecision(
                expected.granted,
                response.status,
              );
              if (decision.length > 0)
                problems.push(
                  ...decision.map((problem) => `${step + 1}番目: ${problem}`),
                );
              else if (response.status === 200)
                problems.push(
                  ...(await inspectGrantResponse(
                    response,
                    grantOf(spec),
                    true,
                  )),
                );
              else problems.push(...(await inspectRejection(response)));
            }
            if (problems.length > 0)
              failures.push(
                `${spec.label}: [${describeInput(first)}] → [${describeInput(second)}]: ${problems.join("、")}`,
              );
          }
      }
      expect(sequences).toBe(3456);
      expect(
        failures.slice(0, MAX_REPORTED),
        `違反${failures.length}件`,
      ).toEqual([]);
    });

    it("同じコードへ同時に届いた2要求でも成功は高々1回で、両方が正当なら1回成功する", async () => {
      const failures: string[] = [];
      let pairs = 0;
      for (const [index, spec] of codeSpecs.entries()) {
        const other = codeSpecs[(index + 1) % codeSpecs.length];
        const inputs = exchangeInputs(spec, other);
        for (const first of inputs)
          for (const second of inputs) {
            if (second.at !== first.at) continue;
            pairs++;
            const code = issue(spec);
            vi.setSystemTime(first.at);
            const responses = await Promise.all(
              [first, second].map((input) =>
                post(input.identity, {
                  grant_type: "authorization_code",
                  code,
                  redirect_uri: input.redirect,
                  code_verifier: input.verifier,
                }),
              ),
            );
            const problems: string[] = [];
            const valid = [first, second].map(
              (input) => expectedExchange(spec, input, false).granted,
            );
            const granted = responses.filter((r) => r.status === 200).length;
            if (granted > 1) problems.push(`${granted}回成功した`);
            if (valid[0] && valid[1] && granted !== 1)
              problems.push(`両方正当なのに成功${granted}回`);
            for (const [i, response] of responses.entries()) {
              if (response.status !== 200) continue;
              if (!valid[i]) problems.push(`${i + 1}番目が条件外で成功した`);
              else
                problems.push(
                  ...(await inspectGrantResponse(
                    response,
                    grantOf(spec),
                    true,
                  )),
                );
            }
            if (problems.length > 0)
              failures.push(
                `${spec.label}: [${describeInput(first)}] ∥ [${describeInput(second)}]: ${problems.join("、")}`,
              );
          }
      }
      expect(pairs).toBe(1728);
      expect(
        failures.slice(0, MAX_REPORTED),
        `違反${failures.length}件`,
      ).toEqual([]);
    });

    it("更新トークンは発行先のクライアントが期限内に使う時だけ、同じ利用者・クライアント・スコープのアクセス権を発行する", async () => {
      const tokens: {
        label: string;
        token: string;
        refresh: boolean;
        grant: Grant;
      }[] = [];
      for (const spec of codeSpecs) {
        const code = issue(spec);
        const identity = identities.find(
          (i) => i.authenticated && i.clientId === spec.client.id,
        )!;
        const response = await post(identity, {
          grant_type: "authorization_code",
          code,
          redirect_uri: spec.client.redirect,
          code_verifier: spec.verifier,
        });
        expect(response.status).toBe(200);
        const body = await response.json();
        tokens.push(
          {
            label: `${spec.label}の更新トークン`,
            token: body.refresh_token,
            refresh: true,
            grant: grantOf(spec),
          },
          {
            label: `${spec.label}のアクセストークン`,
            token: body.access_token,
            refresh: false,
            grant: grantOf(spec),
          },
        );
      }
      const [header, payload, signature] = tokens[0].token.split(".");
      const forged = JSON.parse(Buffer.from(payload, "base64url").toString());
      forged.sub = "2";
      tokens.push({
        label: "利用者を書き換えた更新トークン",
        token: `${header}.${Buffer.from(JSON.stringify(forged)).toString("base64url")}.${signature}`,
        refresh: false,
        grant: tokens[0].grant,
      });

      const failures: string[] = [];
      let requests = 0;
      for (const entry of tokens)
        for (const identity of identities)
          for (const at of [
            T0 + 1_000,
            T0 + REFRESH_TTL_MS - 1_000,
            T0 + REFRESH_TTL_MS,
          ])
            for (const extraScope of [undefined, "mcp admin"]) {
              requests++;
              vi.setSystemTime(at);
              const params: Record<string, string> = {
                grant_type: "refresh_token",
                refresh_token: entry.token,
              };
              if (extraScope) params.scope = extraScope;
              const response = await post(identity, params);
              const granted =
                entry.refresh &&
                identity.authenticated &&
                identity.clientId === entry.grant.clientId &&
                at - T0 < REFRESH_TTL_MS;
              const problems = inspectDecision(granted, response.status);
              if (problems.length === 0 && response.status === 200)
                problems.push(
                  ...(await inspectGrantResponse(response, entry.grant, false)),
                );
              else if (problems.length === 0)
                problems.push(...(await inspectRejection(response)));
              if (problems.length > 0)
                failures.push(
                  `${entry.label}・${identity.label}・T0+${at - T0}ms・scope=${extraScope ?? "なし"}: ${problems.join("、")}`,
                );
            }
      expect(requests).toBe(162);
      expect(
        failures.slice(0, MAX_REPORTED),
        `違反${failures.length}件`,
      ).toEqual([]);
    });

    it("アクセストークンの検証はアクセス用途の期限内のトークンだけを発行時の内容で受け付ける", async () => {
      const failures: string[] = [];
      for (const spec of codeSpecs) {
        const code = issue(spec);
        const identity = identities.find(
          (i) => i.authenticated && i.clientId === spec.client.id,
        )!;
        const body = await (
          await post(identity, {
            grant_type: "authorization_code",
            code,
            redirect_uri: spec.client.redirect,
            code_verifier: spec.verifier,
          })
        ).json();
        for (const at of [T0 + ACCESS_TTL_MS - 1_000, T0 + ACCESS_TTL_MS]) {
          vi.setSystemTime(at);
          const access = await oauth.verifyAccessToken(body.access_token);
          const valid = at - T0 < ACCESS_TTL_MS;
          const expected = grantOf(spec);
          if (valid) {
            if (
              !access ||
              access.userId !== expected.userId ||
              access.clientId !== expected.clientId ||
              access.scope !== expected.scope
            )
              failures.push(
                `${spec.label}・T0+${at - T0}ms: ${JSON.stringify(access)}`,
              );
          } else if (access)
            failures.push(`${spec.label}・T0+${at - T0}ms: 失効後に受け付けた`);
          if (await oauth.verifyAccessToken(body.refresh_token))
            failures.push(
              `${spec.label}・T0+${at - T0}ms: 更新トークンを受け付けた`,
            );
        }
      }
      expect(failures).toEqual([]);
    });
  },
);
