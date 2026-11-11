/**
 * @fileoverview 環境変数の型安全な管理
 */

import fs from "node:fs";
import crypto from "node:crypto";
import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().url(),
  DATA_DIR: z.string().default("./data"),
  NODE_ENV: z
    .enum(["development", "production", "test"])
    .default("development"),
  PROTOCOL_HEADER: z.string().optional(),
  WEBAUTHN_RP_ID: z.string().optional(),
  WEBAUTHN_ORIGINS: z.string().optional(),
});

/** ビルド時のpostbuild分析で実行されるため遅延評価する */
let _env: z.infer<typeof envSchema> | null = null;

/** 環境変数を取得する（初回呼び出し時にバリデーション） */
export function getEnv(): z.infer<typeof envSchema> {
  if (!_env) {
    _env = envSchema.parse(process.env);
  }
  return _env;
}

// ── 暗号化キー・JWT秘密鍵の管理 ──

let _encryptKey: string | null = null;
let _jwtSecret: string | null = null;

/**
 * 鍵ファイルを読み込む（32バイトバイナリ形式、Base64文字列として返す）
 */
function loadOrCreateKey(keyPath: string): string {
  fs.mkdirSync(getEnv().DATA_DIR, { recursive: true });

  if (!fs.existsSync(keyPath)) {
    const newKey = crypto.randomBytes(32);
    fs.writeFileSync(keyPath, newKey);
    return newKey.toString("base64");
  }

  return fs.readFileSync(keyPath).toString("base64");
}

/**
 * 暗号化キーを取得する（初回起動時に自動生成）
 */
export function getEncryptKey(): string {
  if (!_encryptKey) {
    _encryptKey = loadOrCreateKey(`${getEnv().DATA_DIR}/.encrypt_key`);
  }
  return _encryptKey;
}

/**
 * JWT署名用秘密鍵を取得する（初回起動時に自動生成）
 */
export function getJwtSecret(): string {
  if (!_jwtSecret) {
    _jwtSecret = loadOrCreateKey(`${getEnv().DATA_DIR}/.secret_key`);
  }
  return _jwtSecret;
}
