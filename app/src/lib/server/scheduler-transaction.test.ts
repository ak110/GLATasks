import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  failUpdate: false,
  committed: [] as string[],
  pending: [] as string[],
}));
const db = vi.hoisted(() => {
  const tx = {
    update: vi.fn(() => ({
      set: vi.fn(() => ({
        where: vi.fn(async () => {
          if (state.failUpdate) throw new Error("更新失敗");
          state.pending.push("発火時刻");
        }),
      })),
    })),
  };
  return {
    tx,
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        innerJoin: vi.fn(() => ({
          where: vi.fn(async () => [
            {
              userId: 42,
              schedule: {
                id: 1,
                list_id: 7,
                title: "定期TODO",
                tags: "[]",
                rrule:
                  "DTSTART;TZID=Asia/Tokyo:20260101T090000\nRRULE:FREQ=DAILY",
                created: new Date("2026-01-01T00:00:00Z"),
                last_fired: null,
              },
            },
          ]),
        })),
      })),
    })),
    transaction: vi.fn(
      async (callback: (connection: typeof tx) => Promise<void>) => {
        state.pending = [];
        await callback(tx);
        state.committed.push(...state.pending);
      },
    ),
  };
});

vi.mock("./db", () => ({ getDb: () => db }));
vi.mock("./api/common", () => ({ parseTags: () => [] }));
vi.mock("./api/tasks", () => ({
  createTask: vi.fn(async (...args: unknown[]) => {
    expect(args[5]).toBe(db.tx);
    state.pending.push("タスク");
  }),
}));
vi.mock("./calorie-scheduler", () => ({ processCalorieAutoRecords: vi.fn() }));
vi.mock("./operations/scheduler", () => ({
  notifyScheduleExecution: vi.fn(() => {
    expect(state.committed.length).toBeGreaterThanOrEqual(3);
    expect(state.committed.at(-1)).toBe("発火時刻");
    expect(
      state.committed.slice(0, -1).every((value) => value === "タスク"),
    ).toBe(true);
  }),
  notifyCalorieExecution: vi.fn(),
}));

import { processSchedules } from "./scheduler";
import { notifyScheduleExecution } from "./operations/scheduler";

describe("定期タスクの原子的な書き込み", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.failUpdate = false;
    state.committed = [];
    state.pending = [];
  });

  it("生成と発火時刻を同じ接続へ書き込み、完了後に通知する", async () => {
    expect(await processSchedules(new Date("2026-01-05T00:00:00Z"))).toBe(true);
    expect(db.transaction).toHaveBeenCalledOnce();
    expect(notifyScheduleExecution).toHaveBeenCalledWith(42);
  });

  it("発火時刻の更新失敗ではタスクを確定せず通知もしない", async () => {
    state.failUpdate = true;
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await processSchedules(new Date("2026-01-05T00:00:00Z"))).toBe(
        false,
      );
      expect(state.committed).toEqual([]);
      expect(notifyScheduleExecution).not.toHaveBeenCalled();
      expect(log).toHaveBeenCalledOnce();
    } finally {
      log.mockRestore();
    }
  });
});
