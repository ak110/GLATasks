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

  /** テスト用: 指定タイプのイベントを発火する */
  dispatch(type: string, data: string = ""): void {
    const event = { data } as MessageEvent;
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
    // EventSource の自動再接続のたびに全クエリを invalidate する。
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
