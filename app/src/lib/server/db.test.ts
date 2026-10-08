/** 開発サーバーの再評価でプールを共有し、クライアントは再評価後のスキーマで作成することを検証する。 */
import { int, mysqlTable } from "drizzle-orm/mysql-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const DEV_POOL_KEY = Symbol.for("glatasks.server.db.pool");

const createPool = vi.hoisted(() => vi.fn());

vi.mock("mysql2/promise", () => ({ default: { createPool } }));

/** `db.ts`を新しく評価し直す（開発サーバーのコード更新に相当する）。 */
async function evaluateDbModule() {
  vi.resetModules();
  return await import("./db");
}

beforeEach(() => {
  let created = 0;
  createPool.mockReset().mockImplementation(() => ({ poolId: ++created }));
  delete (globalThis as { [DEV_POOL_KEY]?: unknown })[DEV_POOL_KEY];
  vi.stubEnv("DATABASE_URL", "mysql://user:pass@db.invalid/glatasks");
});

afterEach(() => {
  vi.doUnmock("./schema");
  vi.unstubAllEnvs();
  delete (globalThis as { [DEV_POOL_KEY]?: unknown })[DEV_POOL_KEY];
});

describe("getDb（開発サーバー）", () => {
  beforeEach(() => {
    vi.stubEnv("DEV", true);
  });

  it("再評価をまたいで1つのプールを使い、再評価前の呼び出し元も同じクライアントを使い続ける", async () => {
    const before = await evaluateDbModule();
    const beforeDb = before.getDb();
    const after = await evaluateDbModule();
    const afterDb = after.getDb();

    expect(createPool).toHaveBeenCalledTimes(1);
    expect(createPool).toHaveBeenCalledWith({
      uri: "mysql://user:pass@db.invalid/glatasks",
      connectionLimit: 5,
    });
    expect(afterDb).not.toBe(beforeDb);
    expect(before.getDb()).toBe(beforeDb);
  });

  it("再評価後のクライアントは新しいスキーマを使い、古いスキーマへ固定されない", async () => {
    const before = await evaluateDbModule();
    const beforeDb = before.getDb();
    vi.doMock("./schema", () => ({
      added_table: mysqlTable("added_table", { id: int("id").primaryKey() }),
    }));
    const after = await evaluateDbModule();
    const afterDb = after.getDb();

    expect(createPool).toHaveBeenCalledTimes(1);
    expect(Object.keys(afterDb.query)).toEqual(["added_table"]);
    expect(Object.keys(beforeDb.query)).toContain("users");
    expect(Object.keys(beforeDb.query)).not.toContain("added_table");
  });
});

describe("getDb（本番）", () => {
  it("開発用の共有保持を使わず、モジュールごとにプールを作成する", async () => {
    vi.stubEnv("DEV", false);
    (await evaluateDbModule()).getDb();
    (await evaluateDbModule()).getDb();

    expect(createPool).toHaveBeenCalledTimes(2);
    expect(DEV_POOL_KEY in globalThis).toBe(false);
  });
});
