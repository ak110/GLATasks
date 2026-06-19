/**
 * @fileoverview MCP OAuth2.1認可サーバーの永続化層
 *
 * - 登録クライアント（DCR で生成）はファイルへ永続化する
 * - 認可コードは短命なため、プロセス内Mapで保持する
 */

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { getEnv } from "../env";

export interface RegisteredClient {
  client_id: string;
  client_id_issued_at: number;
  client_secret?: string;
  client_secret_expires_at?: number;
  redirect_uris: string[];
  token_endpoint_auth_method: string;
  grant_types: string[];
  response_types: string[];
  scope?: string;
  client_name?: string;
}

export interface AuthorizationCodeRecord {
  code: string;
  client_id: string;
  redirect_uri: string;
  user_id: number;
  scope: string;
  code_challenge: string;
  code_challenge_method: string;
  resource?: string;
  expires_at: number;
}

/** 認可コードの有効期間（秒）。OAuth 2.1 は 10分以内を推奨する */
const AUTH_CODE_TTL_SECONDS = 600;

/** 登録クライアントの保存先 */
function getClientsPath(): string {
  return path.join(getEnv().DATA_DIR, ".mcp_clients.json");
}

let clientsCache: Map<string, RegisteredClient> | null = null;

function loadClients(): Map<string, RegisteredClient> {
  if (clientsCache) return clientsCache;
  const filePath = getClientsPath();
  if (!fs.existsSync(filePath)) {
    clientsCache = new Map();
    return clientsCache;
  }
  const raw = fs.readFileSync(filePath, "utf8");
  const arr = JSON.parse(raw) as RegisteredClient[];
  clientsCache = new Map(arr.map((c) => [c.client_id, c]));
  return clientsCache;
}

function saveClients(): void {
  if (!clientsCache) return;
  fs.mkdirSync(getEnv().DATA_DIR, { recursive: true });
  const tmp = getClientsPath() + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify([...clientsCache.values()], null, 2));
  fs.renameSync(tmp, getClientsPath());
}

export function getClient(clientId: string): RegisteredClient | null {
  return loadClients().get(clientId) ?? null;
}

export function registerClient(
  metadata: Omit<RegisteredClient, "client_id" | "client_id_issued_at">,
): RegisteredClient {
  const client: RegisteredClient = {
    ...metadata,
    client_id: crypto.randomUUID(),
    client_id_issued_at: Math.floor(Date.now() / 1000),
  };
  loadClients().set(client.client_id, client);
  saveClients();
  return client;
}

// ── 認可コード（短命・プロセス内） ──

const codes = new Map<string, AuthorizationCodeRecord>();

export function issueAuthorizationCode(
  params: Omit<AuthorizationCodeRecord, "code" | "expires_at">,
): string {
  pruneExpiredCodes();
  const code = crypto.randomBytes(32).toString("base64url");
  codes.set(code, {
    ...params,
    code,
    expires_at: Date.now() + AUTH_CODE_TTL_SECONDS * 1000,
  });
  return code;
}

/** 認可コードを消費する（1回だけ取得可能）。期限切れ・未知の場合は null。 */
export function consumeAuthorizationCode(
  code: string,
): AuthorizationCodeRecord | null {
  const record = codes.get(code);
  if (!record) return null;
  codes.delete(code);
  if (record.expires_at < Date.now()) return null;
  return record;
}

function pruneExpiredCodes(): void {
  const now = Date.now();
  for (const [key, value] of codes) {
    if (value.expires_at < now) codes.delete(key);
  }
}
