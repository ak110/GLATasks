/** 監視APIから定期処理の起動・障害・復旧とDBの応答を検証する。 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const database = vi.hoisted(() => ({
  execute: vi.fn(),
  rows: vi.fn(),
  transaction: vi.fn(),
}));

vi.mock("./db", () => ({
  getDb: () => ({
    execute: database.execute,
    transaction: database.transaction,
    select: () => ({
      from: () => ({
        where: database.rows,
        innerJoin: () => ({ where: database.rows }),
      }),
    }),
  }),
}));

beforeEach(() => {
  vi.resetModules();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  database.execute.mockReset().mockResolvedValue([]);
  database.rows.mockReset().mockResolvedValue([]);
  database.transaction.mockReset().mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function start() {
  const { startScheduler } = await import("./scheduler");
  startScheduler();
  await vi.advanceTimersByTimeAsync(0);
}

describe("GET /healthcheck/ready", () => {
  it("起動直後は503、正常実行後は200となり、停滞後は503になる", async () => {
    const { GET } = await import("../../routes/healthcheck/ready/+server");
    let response = await GET();
    expect(response.status).toBe(503);
    expect((await response.json()).scheduler.status).toBe("starting");

    await start();
    response = await GET();
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({
      status: "ok",
      database: "ok",
      scheduler: {
        status: "ok",
        last_success_at: "2026-01-01T00:00:00.000Z",
        last_finished_at: "2026-01-01T00:00:00.000Z",
      },
    });

    vi.setSystemTime(new Date("2026-01-01T00:02:01Z"));
    response = await GET();
    expect(response.status).toBe(503);
    expect((await response.json()).scheduler.status).toBe("stale");
  });

  it("DB障害を503で返し、例外詳細を公開せず復旧後に200となる", async () => {
    await start();
    const { GET } = await import("../../routes/healthcheck/ready/+server");
    database.execute.mockRejectedValueOnce(new Error("秘密の接続情報"));
    const response = await GET();
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ database: "error" });
    expect((await GET()).status).toBe(200);
  });

  it("DBが応答しなくても時間切れで503を返す", async () => {
    await start();
    const { GET } = await import("../../routes/healthcheck/ready/+server");
    database.execute.mockImplementationOnce(() => new Promise(() => {}));
    const pending = GET();
    await vi.advanceTimersByTimeAsync(2000);
    const response = await pending;
    expect(response.status).toBe(503);
    expect((await response.json()).database).toBe("error");
  });

  it.each(["todo", "calories"])(
    "%sの定期処理に失敗しても次の周期で回復する",
    async (domain) => {
      if (domain === "calories") database.rows.mockResolvedValueOnce([]);
      database.rows.mockRejectedValueOnce(new Error("DB不通"));
      await start();
      const { GET } = await import("../../routes/healthcheck/ready/+server");
      let response = await GET();
      expect(response.status).toBe(503);
      expect((await response.json()).scheduler.status).toBe("error");

      await vi.advanceTimersByTimeAsync(60_000);
      response = await GET();
      expect(response.status).toBe(200);
      expect((await response.json()).scheduler.last_success_at).toBe(
        "2026-01-01T00:01:00.000Z",
      );
    },
  );

  it.each(["todo", "calories"])(
    "%sの個別予定が失敗した周期を成功と扱わず、修復後に回復する",
    async (domain) => {
      if (domain === "todo") {
        database.rows.mockResolvedValueOnce([
          {
            userId: 123,
            schedule: {
              id: 1,
              rrule: "DTSTART:INVALID\nRRULE:FREQ=DAILY",
              created: new Date("2025-12-31T00:00:00Z"),
              last_fired: null,
            },
          },
        ]);
      } else {
        database.rows
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([
            { id: 1, next_run_at: new Date("2025-12-31T00:00:00Z") },
          ]);
        database.transaction.mockRejectedValueOnce(new Error("記録に失敗"));
      }
      await start();
      const { GET } = await import("../../routes/healthcheck/ready/+server");
      const response = await GET();
      expect(response.status).toBe(503);
      expect((await response.json()).scheduler.status).toBe("error");
      await vi.advanceTimersByTimeAsync(60_000);
      expect((await GET()).status).toBe(200);
    },
  );
});
