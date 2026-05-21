/**
 * @fileoverview SSE クライアントのユニットテスト
 *
 * EventSource は環境に存在しないためモックを注入する。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/** EventSource モック: addEventListener / dispatch / readyState を最小実装 */
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

  /** テスト用: 指定タイプのイベントを発火する。lastEventIdも与えられる */
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
    // 既存の EventSource 型と衝突するため unknown 経由で差し替える
    (
      globalThis as unknown as { EventSource: typeof MockEventSource }
    ).EventSource = MockEventSource;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as unknown as { EventSource?: typeof MockEventSource })
      .EventSource;
  });

  it("connected イベント受信時に queryClient.invalidateQueries を呼ぶ", async () => {
    // 切断中に取りこぼしたかもしれない更新を取り直すため、初回接続および
    // EventSource の自動再接続のたびに全クエリーを invalidate する。
    const { connect, disconnect } = await import("./sse-client");
    const invalidate = vi.fn().mockResolvedValue(undefined);
    const queryClient = {
      invalidateQueries: invalidate,
    } as unknown as import("@tanstack/svelte-query").QueryClient;

    connect(queryClient);
    expect(MockEventSource.instances.length).toBe(1);

    const es = MockEventSource.instances[0];
    // 1回目 (初回接続)
    es.dispatch("connected", String(Date.now()));
    expect(invalidate).toHaveBeenCalledTimes(1);

    // 2回目 (再接続シミュレーション): 同じ listener が再発火する
    es.dispatch("connected", String(Date.now()));
    expect(invalidate).toHaveBeenCalledTimes(2);

    disconnect();
  });

  it("connected イベントでサーバー時刻オフセットを設定する", async () => {
    const { connect, disconnect, getServerOffset } =
      await import("./sse-client");
    const queryClient = {
      invalidateQueries: vi.fn().mockResolvedValue(undefined),
    } as unknown as import("@tanstack/svelte-query").QueryClient;

    connect(queryClient);
    const serverMs = Date.now() + 5000;
    MockEventSource.instances[0].dispatch("connected", String(serverMs));

    // オフセットは ±数 ms の誤差があるため範囲で確認
    const offset = getServerOffset();
    expect(offset).toBeGreaterThan(4900);
    expect(offset).toBeLessThan(5100);

    disconnect();
  });

  // 同値分割: 経過時間（閾値内 / 閾値超過）
  // 境界値: 74秒（閾値直前）・75秒（閾値ちょうど）・76秒（閾値直後）
  // 閾値75秒以上で強制再接続が発火し、新規 EventSource が生成される
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
        await import("./sse-client");
      const queryClient = {
        invalidateQueries: vi.fn().mockResolvedValue(undefined),
      } as unknown as import("@tanstack/svelte-query").QueryClient;

      connect(queryClient);
      expect(MockEventSource.instances.length).toBe(1);

      // 経過時間ぶんシステム時刻を進めて健全性チェックを呼ぶ
      vi.setSystemTime(baseTime + elapsedMs);
      checkConnection();

      // 強制再接続時は新規 EventSource が生成されるため instances が増える
      const expectedInstances = shouldReconnect ? 2 : 1;
      expect(MockEventSource.instances.length).toBe(expectedInstances);

      disconnect();
    },
  );

  // 同値分割: 接続状態（CONNECTING / OPEN / CLOSED）
  // error イベント発火時、CLOSED のときのみ強制再接続する
  // （CONNECTING/OPEN ではブラウザの自動再接続に委ねる）
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
      const { connect, disconnect } = await import("./sse-client");
      const queryClient = {
        invalidateQueries: vi.fn().mockResolvedValue(undefined),
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

  it("reset イベント受信時に全クエリーを invalidate する", async () => {
    // バッファ外れやサーバー再起動時、サーバーが reset を送出する。
    // クライアントは connected と同等の全クエリーinvalidateで整合性を回復する。
    const { connect, disconnect } = await import("./sse-client");
    const invalidate = vi.fn().mockResolvedValue(undefined);
    const queryClient = {
      invalidateQueries: invalidate,
    } as unknown as import("@tanstack/svelte-query").QueryClient;

    connect(queryClient);
    expect(MockEventSource.instances.length).toBe(1);

    MockEventSource.instances[0].dispatch("reset", "", "");
    expect(invalidate).toHaveBeenCalledTimes(1);

    disconnect();
  });

  it("reset イベント受信後の再接続URLには lastEventId パラメータを付けない", async () => {
    // reset 受信時に保持中の lastEventId をクリアし、次回再接続を connected 経路へ戻す。
    // これにより、サーバー側バッファ復元不能時に reset が返り続けるループを避ける。
    const { connect, disconnect } = await import("./sse-client");
    const queryClient = {
      invalidateQueries: vi.fn().mockResolvedValue(undefined),
    } as unknown as import("@tanstack/svelte-query").QueryClient;

    connect(queryClient);
    const es1 = MockEventSource.instances[0];

    // 先に有効なIDを受信して保持させる
    es1.dispatch("connected", String(Date.now()), "5");
    // reset 受信で lastEventId をクリア
    es1.dispatch("reset", "", "");

    // 強制再接続を発火させる
    es1.readyState = MockEventSource.CLOSED;
    es1.dispatch("error");

    expect(MockEventSource.instances.length).toBe(2);
    expect(MockEventSource.instances[1].url).toBe("/api/events");

    disconnect();
  });

  it("初回 connect 時のURLには lastEventId クエリーパラメータを付けない", async () => {
    const { connect, disconnect } = await import("./sse-client");
    const queryClient = {
      invalidateQueries: vi.fn().mockResolvedValue(undefined),
    } as unknown as import("@tanstack/svelte-query").QueryClient;

    connect(queryClient);
    expect(MockEventSource.instances[0].url).toBe("/api/events");
    disconnect();
  });

  // 同値分割: 受信イベントのID保持パターン
  // - 有効なID付き: 保持してURLに反映
  // - 空文字ID: 維持（更新しない）
  // - lastEventId プロパティ自体が欠落: 維持
  // 再接続時のURLに反映するため、forceReconnect 経由で2つ目のEventSourceのURLを観測する
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
      const { connect, disconnect } = await import("./sse-client");
      const queryClient = {
        invalidateQueries: vi.fn().mockResolvedValue(undefined),
      } as unknown as import("@tanstack/svelte-query").QueryClient;

      connect(queryClient);
      const es1 = MockEventSource.instances[0];
      for (const id of lastEventIds) {
        es1.dispatch("connected", String(Date.now()), id);
      }

      // forceReconnect を発火するため CLOSED の error を起こす
      es1.readyState = MockEventSource.CLOSED;
      es1.dispatch("error");

      expect(MockEventSource.instances.length).toBe(2);
      expect(MockEventSource.instances[1].url).toBe(expectedUrl);

      disconnect();
    },
  );

  // 同値分割: 初回接続フェーズの経過時間（閾値以内 / 閾値超過）
  // 境界値: 9秒（直前）・10秒（境界）・11秒（直後）
  // `"initial"` 状態のまま閾値10秒に達した時点で `"unhealthy"` へ遷移する
  it.each([
    { label: "9秒（直前）", elapsedMs: 9_000, expectUnhealthy: false },
    { label: "10秒（境界）", elapsedMs: 10_000, expectUnhealthy: true },
    { label: "11秒（直後）", elapsedMs: 11_000, expectUnhealthy: true },
  ])(
    "健全性: 初回接続フェーズ $label で unhealthy=$expectUnhealthy",
    async ({ elapsedMs, expectUnhealthy }) => {
      vi.useFakeTimers();
      const { connect, disconnect, getHealth } = await import("./sse-client");
      const queryClient = {
        invalidateQueries: vi.fn().mockResolvedValue(undefined),
      } as unknown as import("@tanstack/svelte-query").QueryClient;

      connect(queryClient);
      expect(getHealth()).toBe("initial");

      await vi.advanceTimersByTimeAsync(elapsedMs);
      expect(getHealth()).toBe(expectUnhealthy ? "unhealthy" : "initial");

      disconnect();
    },
  );

  // 同値分割: 接続後フェーズの受信途絶経過時間（閾値以内 / 閾値超過）
  // 境界値: 59秒（直前）・60秒（境界）・61秒（直後）
  // イベント受信で `"healthy"` に遷移後、閾値60秒に達した時点で `"unhealthy"` へ遷移する
  it.each([
    { label: "59秒（直前）", elapsedMs: 59_000, expectUnhealthy: false },
    { label: "60秒（境界）", elapsedMs: 60_000, expectUnhealthy: true },
    { label: "61秒（直後）", elapsedMs: 61_000, expectUnhealthy: true },
  ])(
    "健全性: 接続後フェーズ 受信から $label で unhealthy=$expectUnhealthy",
    async ({ elapsedMs, expectUnhealthy }) => {
      vi.useFakeTimers();
      const { connect, disconnect, getHealth } = await import("./sse-client");
      const queryClient = {
        invalidateQueries: vi.fn().mockResolvedValue(undefined),
      } as unknown as import("@tanstack/svelte-query").QueryClient;

      connect(queryClient);
      MockEventSource.instances[0].dispatch("heartbeat");
      expect(getHealth()).toBe("healthy");

      await vi.advanceTimersByTimeAsync(elapsedMs);
      expect(getHealth()).toBe(expectUnhealthy ? "unhealthy" : "healthy");

      disconnect();
    },
  );

  // 健全性状態の遷移パターン
  // - `"initial"` → 受信 → `"healthy"`
  // - `"healthy"` → 受信途絶60秒 → `"unhealthy"`
  // - `"unhealthy"` → 受信 → `"healthy"`
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
      await import("./sse-client");
    const queryClient = {
      invalidateQueries: vi.fn().mockResolvedValue(undefined),
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
    // 接続から9秒経過後、heartbeat 受信で60秒タイマーへ切り替わる。
    // その後さらに60秒経過するまで unhealthy 遷移しないことを境界値で確認する。
    vi.useFakeTimers();
    const { connect, disconnect, getHealth } = await import("./sse-client");
    const queryClient = {
      invalidateQueries: vi.fn().mockResolvedValue(undefined),
    } as unknown as import("@tanstack/svelte-query").QueryClient;

    connect(queryClient);
    await vi.advanceTimersByTimeAsync(9_000);
    expect(getHealth()).toBe("initial");

    // 受信で healthy へ遷移し、60秒タイマーへ切り替わる
    MockEventSource.instances[0].dispatch("heartbeat");
    expect(getHealth()).toBe("healthy");

    // さらに59秒経過 → healthy 維持（10秒タイマーが残っていたら unhealthy になるはず）
    await vi.advanceTimersByTimeAsync(59_000);
    expect(getHealth()).toBe("healthy");

    // 60秒経過 → unhealthy
    await vi.advanceTimersByTimeAsync(1_000);
    expect(getHealth()).toBe("unhealthy");

    disconnect();
  });

  it("heartbeat イベント受信でウォッチドッグの最終受信時刻が更新される", async () => {
    // heartbeat 受信時刻が最終受信時刻として記録され、
    // 以降のウォッチドッグ判定基準時刻となる。
    vi.useFakeTimers();
    const baseTime = new Date("2026-01-01T00:00:00Z").getTime();
    vi.setSystemTime(baseTime);

    const { connect, disconnect, checkConnection } =
      await import("./sse-client");
    const queryClient = {
      invalidateQueries: vi.fn().mockResolvedValue(undefined),
    } as unknown as import("@tanstack/svelte-query").QueryClient;

    connect(queryClient);
    const es = MockEventSource.instances[0];

    // 60秒後に heartbeat 受信 → 最終受信時刻が更新される
    vi.setSystemTime(baseTime + 60_000);
    es.dispatch("heartbeat", String(baseTime + 60_000));

    // さらに 60秒経過（heartbeat からは 60秒 < 75秒）→ 再接続しない
    vi.setSystemTime(baseTime + 120_000);
    checkConnection();
    expect(MockEventSource.instances.length).toBe(1);

    // heartbeat からさらに 15秒（合計 75秒）経過 → 再接続する
    vi.setSystemTime(baseTime + 60_000 + 75_000);
    checkConnection();
    expect(MockEventSource.instances.length).toBe(2);

    disconnect();
  });
});
