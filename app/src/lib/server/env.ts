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
  DEEPL_API_KEY: z.string().optional(),
});

let _env: z.infer<typeof envSchema> | null = null;

export function getEnv(): z.infer<typeof envSchema> {
  if (!_env) {
    _env = envSchema.parse(process.env);
  }
  return _env;
}

let _encryptKey: string | null = null;
let _jwtSecret: string | null = null;

function loadOrCreateKey(keyPath: string): string {
  fs.mkdirSync(getEnv().DATA_DIR, { recursive: true });

  if (!fs.existsSync(keyPath)) {
    const newKey = crypto.randomBytes(32);
    fs.writeFileSync(keyPath, newKey);
    return newKey.toString("base64");
  }

  return fs.readFileSync(keyPath).toString("base64");
}

export function getEncryptKey(): string {
  if (!_encryptKey) {
    _encryptKey = loadOrCreateKey(`${getEnv().DATA_DIR}/.encrypt_key`);
  }
  return _encryptKey;
}

export function getJwtSecret(): string {
  if (!_jwtSecret) {
    _jwtSecret = loadOrCreateKey(`${getEnv().DATA_DIR}/.secret_key`);
  }
  return _jwtSecret;
}
