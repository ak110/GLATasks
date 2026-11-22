import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";

const generations = vi.hoisted(() => ({ evaluated: 0, calls: [] as number[] }));

vi.mock("./db", () => ({
  getDb: () => ({
    execute: vi.fn(async () => []),
    select: () => ({
      from: () => ({
        innerJoin: () => ({ where: async () => [] }),
      }),
    }),
  }),
}));

type ProcessStateModule = typeof import("./process-state");

async function loadProcessState(): Promise<ProcessStateModule> {
  vi.resetModules();
  return import("./process-state");
}

beforeEach(async () => {
  (await import("./process-state"))._resetProcessStateForTest();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
  generations.evaluated = 0;
  generations.calls = [];
});

afterEach(async () => {
  (await import("./process-state"))._resetProcessStateForTest();
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("processState", () => {
  it("再評価後も同じ名前の状態を返し、作成は1回だけ行う", async () => {
    const create = vi.fn(() => ({ count: 0 }));
    const first = (await loadProcessState()).processState("test.state", create);
    first.count = 3;
    const second = (await loadProcessState()).processState(
      "test.state",
      create,
    );
    expect(second).toBe(first);
    expect(second.count).toBe(3);
    expect(create).toHaveBeenCalledTimes(1);
  });
});

describe("processInterval", () => {
  it("再評価を重ねてもタイマーは1本で、次の周期は最後に渡した処理を呼ぶ", async () => {
    const calls: string[] = [];
    const first = (await loadProcessState()).processInterval(
      "test.poll",
      1000,
      () => calls.push("first"),
    );
    first.start();
    const second = (await loadProcessState()).processInterval(
      "test.poll",
      1000,
      () => calls.push("second"),
    );
    second.start();
    expect(vi.getTimerCount()).toBe(1);

    await vi.advanceTimersByTimeAsync(1000);
    expect(calls).toEqual(["second"]);

    first.stop();
    expect(second.running).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("schedulerのモジュール再評価", () => {
  beforeAll(async () => {
    await import("./scheduler");
    await import("../../routes/healthcheck/ready/+server");
  }, 60_000);

  type Generation = {
    scheduler: typeof import("./scheduler");
    ready: typeof import("../../routes/healthcheck/ready/+server");
  };

  async function loadGeneration(): Promise<Generation> {
    vi.resetModules();
    const generation = ++generations.evaluated;
    vi.doMock("./calorie-scheduler", () => ({
      processCalorieAutoRecords: vi.fn(async () => {
        generations.calls.push(generation);
        return { userIds: [], succeeded: true };
      }),
    }));
    return {
      scheduler: await import("./scheduler"),
      ready: await import("../../routes/healthcheck/ready/+server"),
    };
  }

  it("再評価後の起動呼出しで周期が増えず、healthと次の周期が同じ実行と更新後の処理を表す", async () => {
    const before = await loadGeneration();
    before.scheduler.startScheduler();
    await vi.advanceTimersByTimeAsync(0);
    expect(generations.calls).toEqual([1]);

    const after = await loadGeneration();
    after.scheduler.startScheduler();
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(1);
    expect(generations.calls).toEqual([1]);

    const response = await after.ready.GET();
    expect(response.status).toBe(200);
    expect((await response.json()).scheduler).toMatchObject({
      status: "ok",
      last_success_at: "2026-01-01T00:00:00.000Z",
    });

    await vi.advanceTimersByTimeAsync(60_000);
    expect(generations.calls).toEqual([1, 2]);
    expect(after.scheduler.getSchedulerHealth().last_success_at).toBe(
      "2026-01-01T00:01:00.000Z",
    );
    expect(before.scheduler.getSchedulerHealth().last_success_at).toBe(
      "2026-01-01T00:01:00.000Z",
    );

    after.scheduler.stopScheduler();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("実行中の排他は再評価をまたいで同じ実行に適用される", async () => {
    let release: () => void = () => {};
    const before = await loadGeneration();
    const blocked = vi.mocked(
      (await import("./calorie-scheduler")).processCalorieAutoRecords,
    );
    blocked.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ userIds: [], succeeded: true });
        }),
    );
    before.scheduler.startScheduler();
    await vi.advanceTimersByTimeAsync(0);

    const after = await loadGeneration();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(generations.calls).toEqual([]);
    expect(after.scheduler.getSchedulerHealth().status).toBe("starting");

    release();
    await vi.advanceTimersByTimeAsync(0);
    expect(after.scheduler.getSchedulerHealth().status).toBe("ok");
    after.scheduler.stopScheduler();
  });
});
