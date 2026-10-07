/**
 * @fileoverview Drizzle Kit 設定ファイル
 */

import { defineConfig } from "drizzle-kit";
import { getDatabaseUrl } from "./scripts/database-config.mjs";

export default defineConfig({
  schema: "./src/lib/server/schema.ts",
  out: "../drizzle/migrations",
  dialect: "mysql",
  dbCredentials: process.env.DATABASE_URL
    ? { url: getDatabaseUrl() }
    : undefined,
});
