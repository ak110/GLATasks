/**
 * @fileoverview Drizzle ORM クライアント初期化（mysql2 接続プール）
 */

import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";

import { getDatabaseUrl } from "../../../scripts/database-config.mjs";
import * as schema from "./schema";

let _db: MySql2Database<typeof schema> | null = null;

/** Drizzle クライアントを取得する（シングルトン） */
export function getDb(): MySql2Database<typeof schema> {
  if (!_db) {
    const url = getDatabaseUrl();
    const pool = mysql.createPool({
      uri: url,
      connectionLimit: 5,
      // TIMESTAMP型はUTC保存・自動変換されるためtimezone指定不要
    });
    _db = drizzle(pool, { schema, mode: "default" });
  }
  return _db;
}
