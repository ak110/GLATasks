import { drizzle, type MySql2Database } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";

import { getDatabaseUrl } from "../../../scripts/database-config.mjs";
import * as schema from "./schema";

/**
 * 開発サーバーでプールを保持する`globalThis`上のキー。
 *
 * 開発サーバーはコード更新のたびに同じNode.jsプロセスでこのモジュールを再評価し、`_db`を初期化する。
 * プールをモジュールに保持すると再評価ごとに新しいプールが作成され、閉じられない旧プールの接続が
 * MariaDBの接続上限まで蓄積する。プールだけをモジュールの外へ保持して再評価後も再利用する。
 */
const DEV_POOL_KEY = Symbol.for("glatasks.server.db.pool");

let _db: MySql2Database<typeof schema> | null = null;

function createPool(): mysql.Pool {
  return mysql.createPool({
    uri: getDatabaseUrl(),
    connectionLimit: 5,
  });
}

function getPool(): mysql.Pool {
  if (!import.meta.env.DEV) {
    return createPool();
  }
  const holder = globalThis as { [DEV_POOL_KEY]?: mysql.Pool };
  holder[DEV_POOL_KEY] ??= createPool();
  return holder[DEV_POOL_KEY];
}

export function getDb(): MySql2Database<typeof schema> {
  _db ??= drizzle(getPool(), { schema, mode: "default" });
  return _db;
}
