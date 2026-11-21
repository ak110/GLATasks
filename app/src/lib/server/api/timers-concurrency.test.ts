import { beforeEach, expect, it, vi } from "vitest";
import type { timers } from "../schema.ts";

const boundary = vi.hoisted(() => ({
  getDb: vi.fn(),
}));
vi.mock("../db", () => ({ getDb: boundary.getDb }));
import {
  adjustTimer,
  deleteTimer,
  pauseTimer,
  resetTimer,
  setTimerTime,
  startTimer,
  stopTimer,
  updateTimer,
} from "./timers.ts";

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

const epoch = new Date("2026-01-01T00:00:00Z");
const actions = [
  ["startTimer", () => startTimer(1, 1, 0)],
  ["pauseTimer", () => pauseTimer(1, 1)],
  ["resetTimer", () => resetTimer(1, 1, 0)],
  ["adjustTimer(+1)", () => adjustTimer(1, 1, 1)],
  ["adjustTimer(-1)", () => adjustTimer(1, 1, -1)],
  ["stopTimer()", () => stopTimer(1, 1)],
  [
    "stopTimer(saved)",
    (row?: Row) =>
      stopTimer(1, 1, row?.started_at?.toISOString() ?? epoch.toISOString()),
  ],
  ["stopTimer(stale)", () => stopTimer(1, 1, epoch.toISOString())],
  ["setTimerTime(0)", () => setTimerTime(1, 1, 0)],
  ["setTimerTime(60)", () => setTimerTime(1, 1, 60)],
  [
    "updateTimer(mode)",
    (row?: Row) =>
      updateTimer(
        1,
        1,
        row?.mode === "alarm"
          ? { mode: "countdown", baseSeconds: 60 }
          : { mode: "alarm", targetMinutes: 60, tzOffsetMinutes: 0 },
      ),
  ],
  ["updateTimer(name)", () => updateTimer(1, 1, { name: "renamed" })],
  ["deleteTimer", () => deleteTimer(1, 1)],
] as const;

function isolatedRow(initial: Row) {
  let row: Row | undefined = initial;
  let transaction = false;
  let locked = false;
  const db = {
    select: () => {
      const query = {
        from: () => query,
        where: () => query,
        limit: () => query,
        for: (mode: string) => {
          expect(transaction).toBe(true);
          expect(mode).toBe("update");
          locked = true;
          return query;
        },
        then: (resolve: (rows: Row[]) => unknown) =>
          Promise.resolve(resolve(row ? [{ ...row }] : [])),
      };
      return query;
    },
    update: () => ({
      set: (values: Partial<Row>) => ({
        where: async () => {
          expect(transaction && locked).toBe(true);
          if (!row) throw new Error("削除済みの行への更新");
          row = { ...row, ...values };
        },
      }),
    }),
    delete: () => ({
      where: async () => {
        row = undefined;
      },
    }),
    transaction: async (callback: (connection: unknown) => Promise<void>) => {
      transaction = true;
      locked = false;
      try {
        await callback(db);
      } finally {
        transaction = false;
      }
    },
  };
  boundary.getDb.mockReturnValue(db);
  return () => row;
}

it("単一タイマーの有界な操作列で保存状態と拒否条件を保つ", async () => {
  let checked = 0;
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    for (const mode of ["countdown", "alarm"] as const) {
      for (const state of ["zero", "stopped", "running", "expired"] as const) {
        for (const elapsed of [1, 61]) {
          const initial: Row = {
            id: 1,
            user_id: 1,
            name: "timer",
            mode,
            base_seconds: mode === "alarm" ? 0 : 60,
            target_minutes: mode === "alarm" ? 60 : null,
            adjust_minutes: 1,
            remaining_seconds: state === "zero" || state === "expired" ? 0 : 60,
            started_at: state === "running" ? epoch : null,
            running: Number(state === "running"),
            expired: Number(state === "expired"),
            ephemeral: 0,
            ring_seconds: 3,
            sort_order: 0,
            created: epoch,
            updated: epoch,
          };
          for (const first of actions) {
            for (const second of actions) {
              const read = isolatedRow(initial);
              // 2要求は同じ保存状態を見て送信され、DBで両方の順序を取り得る。
              const pair = [first, second];
              for (const [index, [name, run]] of pair.entries()) {
                vi.setSystemTime(epoch.getTime() + (elapsed + index) * 1000);
                const before = read();
                const trace = `${mode}/${state}/${elapsed}: ${first[0]} → ${second[0]} (手順 ${index + 1})`;
                const operation = run(initial);
                if (name !== "deleteTimer" && !before) {
                  await expect(operation, trace).rejects.toThrow(
                    "not_found_or_forbidden",
                  );
                  expect(read(), trace).toBeUndefined();
                } else if (
                  before?.running &&
                  (name.startsWith("setTimerTime") ||
                    (name === "updateTimer(mode)" &&
                      before.mode === initial.mode))
                ) {
                  await expect(operation, trace).rejects.toThrow(
                    "timer_is_running",
                  );
                  expect(read(), trace).toEqual(before);
                } else {
                  await operation;
                  const after = read();
                  if (name === "deleteTimer") {
                    expect(after, trace).toBeUndefined();
                  } else {
                    if (!after) throw new Error(trace);
                    expect(
                      after.remaining_seconds,
                      trace,
                    ).toBeGreaterThanOrEqual(0);
                    if (after.expired)
                      expect(after.remaining_seconds, trace).toBe(0);
                    if (after.running) {
                      expect(after.started_at, trace).not.toBeNull();
                      expect(after.expired, trace).toBe(0);
                    } else {
                      expect(after.started_at, trace).toBeNull();
                    }
                    if (
                      name.startsWith("stopTimer(") &&
                      name !== "stopTimer()" &&
                      before?.running &&
                      before.started_at?.toISOString() !==
                        (name === "stopTimer(saved)"
                          ? (initial.started_at ?? epoch)
                          : epoch
                        ).toISOString()
                    ) {
                      expect(after, trace).toMatchObject({
                        running: 1,
                        expired: 0,
                        started_at: before.started_at,
                        remaining_seconds: before.remaining_seconds,
                      });
                    }
                  }
                }
                checked++;
              }
            }
          }
        }
      }
    }
    expect(checked).toBe(5408);
  } finally {
    vi.useRealTimers();
  }
});
