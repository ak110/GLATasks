/**
 * @fileoverview SSE クライアントのユニットテスト
 *
 * EventSource は環境に存在しないためモックを注入する。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/** EventSource モック: addEventListener / dispatch を最小実装 */
class MockEventSource {
  static instances: MockEventSource[] = [];
  url: string;
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
  dispatch(type: string, data: string): void {
    const event = { data } as MessageEvent;
    for (const cb of this.listeners.get(type) ?? []) cb(event);
  }

  close(): void {
    /* noop */
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
});
