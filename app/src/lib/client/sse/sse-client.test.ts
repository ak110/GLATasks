import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

class MockEventSource {
  static CONNECTING = 0 as const;
  static OPEN = 1 as const;
  static CLOSED = 2 as const;
  static instances: MockEventSource[] = [];
  url: string;
  readyState: number = MockEventSource.OPEN;
  private listeners = new Map<string, ((e: MessageEvent) => void)[]>();

  constructor(url: string) {
    this.url = url;
    MockEventSource.instances.push(this);
  }

  addEventListener(type: string, cb: (e: MessageEvent) => void): void {
    let arr = this.listeners.get(type);
    if (!arr) {
      arr = [];
      this.listeners.set(type, arr);
    }
    arr.push(cb);
  }

  dispatch(type: string, data: string = "", lastEventId: string = ""): void {
    const event = { data, lastEventId } as MessageEvent;
    for (const cb of this.listeners.get(type) ?? []) cb(event);
  }

  close(): void {
    this.readyState = MockEventSource.CLOSED;
  }
}

describe("sse-client", () => {
  beforeEach(() => {
    vi.resetModules();
    MockEventSource.instances = [];
    (
      globalThis as unknown as { EventSource: typeof MockEventSource }
    ).EventSource = MockEventSource;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as unknown as { EventSource?: typeof MockEventSource })
      .EventSource;
  });

  it("connected イベント受信時に queryClient.resetQueries を呼ぶ", async () => {
    const { connect, disconnect } =
      await import("#lib/client/sse/sse-client.ts");
    const reset = vi.fn().mockResolvedValue(undefined);
    const queryClient = {
      resetQueries: reset,
    } as unknown as import("@tanstack/svelte-query").QueryClient;

    connect(queryClient);
    expect(MockEventSource.instances.length).toBe(1);

    const es = MockEventSource.instances[0];
    es.dispatch("connected", String(Date.now()));
    expect(reset).toHaveBeenCalledTimes(1);

    es.dispatch("connected", String(Date.now()));
    expect(reset).toHaveBeenCalledTimes(2);

    disconnect();
  });

  it("connected イベントでサーバー時刻オフセットを設定する", async () => {
    const { connect, disconnect } =
      await import("#lib/client/sse/sse-client.ts");
    const queryClient = {
      resetQueries: vi.fn().mockResolvedValue(undefined),
    } as unknown as import("@tanstack/svelte-query").QueryClient;

    connect(queryClient);
    const serverMs = Date.now() + 5000;
    MockEventSource.instances[0].dispatch("connected", String(serverMs));

    const { getServerOffset } = await import("#lib/client/timers/time-sync.ts");
    const offset = getServerOffset();
    expect(offset).toBeGreaterThan(4900);
    expect(offset).toBeLessThan(5100);

    disconnect();
  });

  it.each([
    { label: "74秒（閾値直前）", elapsedMs: 74_000, shouldReconnect: false },
    {
      label: "75秒（閾値ちょうど）",
      elapsedMs: 75_000,
      shouldReconnect: true,
    },
    { label: "76秒（閾値直後）", elapsedMs: 76_000, shouldReconnect: true },
  ])(
    "受信ウォッチドッグ: 受信途絶 $label で強制再接続=$shouldReconnect",
    async ({ elapsedMs, shouldReconnect }) => {
      vi.useFakeTimers();
      const baseTime = new Date("2026-01-01T00:00:00Z").getTime();
      vi.setSystemTime(baseTime);

      const { connect, disconnect, checkConnection } =
        await import("#lib/client/sse/sse-client.ts");
      const queryClient = {
        resetQueries: vi.fn().mockResolvedValue(undefined),
      } as unknown as import("@tanstack/svelte-query").QueryClient;

      connect(queryClient);
      expect(MockEventSource.instances.length).toBe(1);

      vi.setSystemTime(baseTime + elapsedMs);
      checkConnection();

      const expectedInstances = shouldReconnect ? 2 : 1;
      expect(MockEventSource.instances.length).toBe(expectedInstances);

      disconnect();
    },
  );

  it.each([
    {
      label: "CONNECTING",
      readyState: MockEventSource.CONNECTING,
      shouldReconnect: false,
    },
    {
      label: "OPEN",
      readyState: MockEventSource.OPEN,
      shouldReconnect: false,
    },
    {
      label: "CLOSED",
      readyState: MockEventSource.CLOSED,
      shouldReconnect: true,
    },
  ])(
    "error イベント: readyState=$label で強制再接続=$shouldReconnect",
    async ({ readyState, shouldReconnect }) => {
      const { connect, disconnect } =
        await import("#lib/client/sse/sse-client.ts");
      const queryClient = {
        resetQueries: vi.fn().mockResolvedValue(undefined),
      } as unknown as import("@tanstack/svelte-query").QueryClient;

      connect(queryClient);
      expect(MockEventSource.instances.length).toBe(1);

      const es = MockEventSource.instances[0];
      es.readyState = readyState;
      es.dispatch("error");

      const expectedInstances = shouldReconnect ? 2 : 1;
      expect(MockEventSource.instances.length).toBe(expectedInstances);

      disconnect();
    },
  );

  it("reset イベント受信時に全クエリーを reset する", async () => {
    const { connect, disconnect } =
      await import("#lib/client/sse/sse-client.ts");
    const reset = vi.fn().mockResolvedValue(undefined);
    const queryClient = {
      resetQueries: reset,
    } as unknown as import("@tanstack/svelte-query").QueryClient;

    connect(queryClient);
    expect(MockEventSource.instances.length).toBe(1);

    MockEventSource.instances[0].dispatch("reset", "", "");
    expect(reset).toHaveBeenCalledTimes(1);

    disconnect();
  });

  it("reset イベント受信後の再接続URLには lastEventId パラメータを付けない", async () => {
    const { connect, disconnect } =
      await import("#lib/client/sse/sse-client.ts");
    const queryClient = {
      resetQueries: vi.fn().mockResolvedValue(undefined),
    } as unknown as import("@tanstack/svelte-query").QueryClient;

    connect(queryClient);
    const es1 = MockEventSource.instances[0];

    es1.dispatch("connected", String(Date.now()), "5");
    es1.dispatch("reset", "", "");

    es1.readyState = MockEventSource.CLOSED;
    es1.dispatch("error");

    expect(MockEventSource.instances.length).toBe(2);
    expect(MockEventSource.instances[1].url).toBe("/api/events");

    disconnect();
  });

  it("初回 connect 時のURLには lastEventId クエリーパラメータを付けない", async () => {
    const { connect, disconnect } =
      await import("#lib/client/sse/sse-client.ts");
    const queryClient = {
      resetQueries: vi.fn().mockResolvedValue(undefined),
    } as unknown as import("@tanstack/svelte-query").QueryClient;

    connect(queryClient);
    expect(MockEventSource.instances[0].url).toBe("/api/events");
    disconnect();
  });

  it.each([
    {
      label: "有効なID付き",
      lastEventIds: ["7"],
      expectedUrl: "/api/events?lastEventId=7",
    },
    {
      label: "空文字ID（更新しない）",
      lastEventIds: [""],
      expectedUrl: "/api/events",
    },
    {
      label: "ID付きの後に空文字（後者は無視）",
      lastEventIds: ["3", ""],
      expectedUrl: "/api/events?lastEventId=3",
    },
    {
      label: "複数受信時は最新IDを採用",
      lastEventIds: ["3", "9"],
      expectedUrl: "/api/events?lastEventId=9",
    },
  ])(
    "lastEventId保持: $label → 再接続URL=$expectedUrl",
    async ({ lastEventIds, expectedUrl }) => {
      const { connect, disconnect } =
        await import("#lib/client/sse/sse-client.ts");
      const queryClient = {
        resetQueries: vi.fn().mockResolvedValue(undefined),
      } as unknown as import("@tanstack/svelte-query").QueryClient;

      connect(queryClient);
      const es1 = MockEventSource.instances[0];
      for (const id of lastEventIds) {
        es1.dispatch("connected", String(Date.now()), id);
      }

      es1.readyState = MockEventSource.CLOSED;
      es1.dispatch("error");

      expect(MockEventSource.instances.length).toBe(2);
      expect(MockEventSource.instances[1].url).toBe(expectedUrl);

      disconnect();
    },
  );

  it.each([
    { label: "9秒（直前）", elapsedMs: 9_000, expectUnhealthy: false },
    { label: "10秒（境界）", elapsedMs: 10_000, expectUnhealthy: true },
    { label: "11秒（直後）", elapsedMs: 11_000, expectUnhealthy: true },
  ])(
    "健全性: 初回接続フェーズ $label で unhealthy=$expectUnhealthy",
    async ({ elapsedMs, expectUnhealthy }) => {
      vi.useFakeTimers();
      const { connect, disconnect, getHealth } =
        await import("#lib/client/sse/sse-client.ts");
      const queryClient = {
        resetQueries: vi.fn().mockResolvedValue(undefined),
      } as unknown as import("@tanstack/svelte-query").QueryClient;

      connect(queryClient);
      expect(getHealth()).toBe("initial");

      await vi.advanceTimersByTimeAsync(elapsedMs);
      expect(getHealth()).toBe(expectUnhealthy ? "unhealthy" : "initial");

      disconnect();
    },
  );

  it.each([
    { label: "59秒（直前）", elapsedMs: 59_000, expectUnhealthy: false },
    { label: "60秒（境界）", elapsedMs: 60_000, expectUnhealthy: true },
    { label: "61秒（直後）", elapsedMs: 61_000, expectUnhealthy: true },
  ])(
    "健全性: 接続後フェーズ 受信から $label で unhealthy=$expectUnhealthy",
    async ({ elapsedMs, expectUnhealthy }) => {
      vi.useFakeTimers();
      const { connect, disconnect, getHealth } =
        await import("#lib/client/sse/sse-client.ts");
      const queryClient = {
        resetQueries: vi.fn().mockResolvedValue(undefined),
      } as unknown as import("@tanstack/svelte-query").QueryClient;

      connect(queryClient);
      MockEventSource.instances[0].dispatch("heartbeat");
      expect(getHealth()).toBe("healthy");

      await vi.advanceTimersByTimeAsync(elapsedMs);
      expect(getHealth()).toBe(expectUnhealthy ? "unhealthy" : "healthy");

      disconnect();
    },
  );

  it.each([
    {
      label: "initial → 受信 → healthy",
      steps: async (es: MockEventSource): Promise<void> => {
        es.dispatch("heartbeat");
      },
      expectStates: ["initial", "healthy"],
    },
    {
      label: "healthy → 受信途絶60秒 → unhealthy",
      steps: async (es: MockEventSource): Promise<void> => {
        es.dispatch("heartbeat");
        await vi.advanceTimersByTimeAsync(60_000);
      },
      expectStates: ["initial", "healthy", "unhealthy"],
    },
    {
      label: "unhealthy → 受信 → healthy",
      steps: async (es: MockEventSource): Promise<void> => {
        es.dispatch("heartbeat");
        await vi.advanceTimersByTimeAsync(60_000);
        es.dispatch("heartbeat");
      },
      expectStates: ["initial", "healthy", "unhealthy", "healthy"],
    },
  ])("健全性遷移: $label", async ({ steps, expectStates }) => {
    vi.useFakeTimers();
    const { connect, disconnect, onHealthChange, getHealth } =
      await import("#lib/client/sse/sse-client.ts");
    const queryClient = {
      resetQueries: vi.fn().mockResolvedValue(undefined),
    } as unknown as import("@tanstack/svelte-query").QueryClient;

    const recorded: string[] = [];
    const unsub = onHealthChange((s) => recorded.push(s));

    connect(queryClient);
    recorded.push(getHealth());
    await steps(MockEventSource.instances[0]);

    expect(recorded).toEqual(expectStates);

    unsub();
    disconnect();
  });

  it("イベント受信で不健全判定タイマーが60秒へリセットされる", async () => {
    vi.useFakeTimers();
    const { connect, disconnect, getHealth } =
      await import("#lib/client/sse/sse-client.ts");
    const queryClient = {
      resetQueries: vi.fn().mockResolvedValue(undefined),
    } as unknown as import("@tanstack/svelte-query").QueryClient;

    connect(queryClient);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(getHealth()).toBe("initial");

    MockEventSource.instances[0].dispatch("heartbeat");
    expect(getHealth()).toBe("healthy");

    await vi.advanceTimersByTimeAsync(59_000);
    expect(getHealth()).toBe("healthy");

    await vi.advanceTimersByTimeAsync(1_000);
    expect(getHealth()).toBe("unhealthy");

    disconnect();
  });

  it("connect 前後で同一イベントを購読しても各ハンドラーは1回ずつ呼ばれる", async () => {
    const { connect, subscribe, disconnect } =
      await import("#lib/client/sse/sse-client.ts");
    const queryClient = {
      resetQueries: vi.fn().mockResolvedValue(undefined),
    } as unknown as import("@tanstack/svelte-query").QueryClient;

    const cbBeforeConnect = vi.fn();
    const cbAfterConnect = vi.fn();

    subscribe("tasks:updated", cbBeforeConnect);
    connect(queryClient);
    const unsubAfter = subscribe("tasks:updated", cbAfterConnect);

    MockEventSource.instances[0].dispatch("tasks:updated", "src-tab");
    expect(cbBeforeConnect).toHaveBeenCalledTimes(1);
    expect(cbAfterConnect).toHaveBeenCalledTimes(1);

    unsubAfter();
    MockEventSource.instances[0].dispatch("tasks:updated", "src-tab");
    expect(cbBeforeConnect).toHaveBeenCalledTimes(2);
    expect(cbAfterConnect).toHaveBeenCalledTimes(1);

    disconnect();
  });

  it("heartbeat イベント受信でウォッチドッグの最終受信時刻が更新される", async () => {
    vi.useFakeTimers();
    const baseTime = new Date("2026-01-01T00:00:00Z").getTime();
    vi.setSystemTime(baseTime);

    const { connect, disconnect, checkConnection } =
      await import("#lib/client/sse/sse-client.ts");
    const queryClient = {
      resetQueries: vi.fn().mockResolvedValue(undefined),
    } as unknown as import("@tanstack/svelte-query").QueryClient;

    connect(queryClient);
    const es = MockEventSource.instances[0];

    vi.setSystemTime(baseTime + 60_000);
    es.dispatch("heartbeat", String(baseTime + 60_000));

    vi.setSystemTime(baseTime + 120_000);
    checkConnection();
    expect(MockEventSource.instances.length).toBe(1);

    vi.setSystemTime(baseTime + 60_000 + 75_000);
    checkConnection();
    expect(MockEventSource.instances.length).toBe(2);

    disconnect();
  });
});
