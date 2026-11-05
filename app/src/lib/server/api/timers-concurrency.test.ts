import { beforeEach, expect, it, vi } from "vitest";
import type { timers } from "../schema.ts";

const boundary = vi.hoisted(() => ({
  getDb: vi.fn(),
}));
vi.mock("../db", () => ({ getDb: boundary.getDb }));
import { stopTimer, updateTimer } from "./timers.ts";

type Row = typeof timers.$inferSelect;

beforeEach(() => vi.clearAllMocks());

// 行ロック取得前に別要求が新しい実行を保存するDB境界を模擬する。
// 非ロック読取は古いsnapshotを返し、FOR UPDATEは現在の保存値を返す。
function setupRace(oldRunning = 1) {
  const oldStart = new Date("2026-01-01T00:00:00Z");
  const newStart = new Date("2026-01-01T00:01:00Z");
  let row: Row = {
    id: 1,
    user_id: 1,
    name: "timer",
    mode: "countdown",
    base_seconds: 60,
    adjust_minutes: 1,
    target_minutes: null,
    remaining_seconds: 60,
    started_at: oldStart,
    running: 1,
    expired: 0,
    ephemeral: 0,
    ring_seconds: 3,
    sort_order: 0,
    created: oldStart,
    updated: oldStart,
  };
  let locked = false;
  const select = () => {
    const snapshot = { ...row, running: oldRunning };
    row = { ...row, started_at: newStart, running: 1 };
    const query = {
      from: () => query,
      where: () => query,
      limit: () => query,
      for: () => {
        locked = true;
        return query;
      },
      then: (resolve: (rows: Row[]) => unknown) =>
        Promise.resolve(resolve([locked ? row : snapshot])),
    };
    return query;
  };
  const db = {
    select,
    update: () => ({
      set: (values: Partial<Row>) => ({
        where: async () => {
          row = { ...row, ...values };
        },
      }),
    }),
    transaction: async (callback: (connection: unknown) => unknown) =>
      callback(db),
  };
  boundary.getDb.mockReturnValue(db);
  return { oldStart, read: () => row };
}

it("停止要求はロック取得後の実行を照合し、新しい実行を変更しない", async () => {
  const race = setupRace();
  await stopTimer(1, 1, race.oldStart.toISOString());
  expect(race.read().running).toBe(1);
  expect(race.read().expired).toBe(0);
});

it("mode変更の可否はロック取得後のrunningで判定する", async () => {
  const race = setupRace(0);
  await expect(
    updateTimer(1, 1, {
      mode: "alarm",
      targetMinutes: 60,
      tzOffsetMinutes: 0,
    }),
  ).rejects.toThrow("timer_is_running");
  expect(race.read().mode).toBe("countdown");
});
