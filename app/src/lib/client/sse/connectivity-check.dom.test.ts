import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

type ConnectivityCheck = typeof import("#lib/client/sse/connectivity-check.js");

function makeFetch(options: {
  status?: number;
  contentType?: string;
  body?: string;
  reject?: boolean;
  timeout?: boolean;
}): typeof fetch {
  if (options.timeout) {
    // AbortSignal.timeoutの打ち切りと同じ種別の例外で失敗させる
    return vi.fn(() =>
      Promise.reject(new DOMException("timed out", "TimeoutError")),
    ) as unknown as typeof fetch;
  }
  if (options.reject) {
    return vi.fn(() =>
      Promise.reject(new TypeError("network error")),
    ) as unknown as typeof fetch;
  }
  return vi.fn(
    async () =>
      new Response(options.body ?? '{"status":"ok"}', {
        status: options.status ?? 200,
        headers: { "Content-Type": options.contentType ?? "application/json" },
      }),
  ) as unknown as typeof fetch;
}

describe("connectivity-check", () => {
  let visibilityState: DocumentVisibilityState;
  let cleanup: (() => void) | undefined;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    visibilityState = "visible";
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => visibilityState,
    });
  });

  afterEach(() => {
    cleanup?.();
    cleanup = undefined;
    vi.useRealTimers();
  });

  // 3区分の同値分割と境界: 到達不能（通信断・511以外の5xx）と応答の横取り（それ以外の不健全）を分ける
  it.each([
    {
      label: "健全（200・JSON・ok）",
      fetch: makeFetch({}),
      expected: "healthy",
    },
    {
      label: "fetch 例外",
      fetch: makeFetch({ reject: true }),
      expected: "unreachable",
    },
    {
      label: "タイムアウト",
      fetch: makeFetch({ timeout: true }),
      expected: "unreachable",
    },
    {
      label: "502",
      fetch: makeFetch({ status: 502 }),
      expected: "unreachable",
    },
    {
      label: "503",
      fetch: makeFetch({ status: 503 }),
      expected: "unreachable",
    },
    {
      label: "511（キャプティブポータル）",
      fetch: makeFetch({ status: 511 }),
      expected: "intercepted",
    },
    {
      label: "407",
      fetch: makeFetch({ status: 407 }),
      expected: "intercepted",
    },
    {
      label: "200・text/html",
      fetch: makeFetch({
        contentType: "text/html",
        body: "<html>login</html>",
      }),
      expected: "intercepted",
    },
    {
      label: "status 値が非ok",
      fetch: makeFetch({ body: '{"status":"error"}' }),
      expected: "intercepted",
    },
    {
      label: "JSON解析失敗",
      fetch: makeFetch({ body: "not-json" }),
      expected: "intercepted",
    },
  ])("classifyHealth: $label → $expected", async ({ fetch, expected }) => {
    const connectivity: ConnectivityCheck =
      await import("#lib/client/sse/connectivity-check.js");
    await expect(connectivity.classifyHealth(fetch)).resolves.toBe(expected);
  });

  it("オフライン画面向けの間隔と即時判定で契機を起動する", async () => {
    const connectivity: ConnectivityCheck =
      await import("#lib/client/sse/connectivity-check.js");
    const onTrigger = vi.fn();
    cleanup = connectivity.startConnectivityTriggers(onTrigger, {
      intervalMs: connectivity.OFFLINE_POLL_INTERVAL_MS,
      immediate: true,
    });
    expect(onTrigger).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(connectivity.OFFLINE_POLL_INTERVAL_MS);
    expect(onTrigger).toHaveBeenCalledTimes(2);
  });

  it("可視状態では30秒ごとに呼び出す", async () => {
    const connectivity: ConnectivityCheck =
      await import("#lib/client/sse/connectivity-check.js");
    const onTrigger = vi.fn();
    cleanup = connectivity.startConnectivityTriggers(onTrigger);

    await vi.advanceTimersByTimeAsync(connectivity.POLL_INTERVAL_MS);
    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it("非表示状態ではポーリングを停止する", async () => {
    const connectivity: ConnectivityCheck =
      await import("#lib/client/sse/connectivity-check.js");
    const onTrigger = vi.fn();
    cleanup = connectivity.startConnectivityTriggers(onTrigger);
    visibilityState = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));

    await vi.advanceTimersByTimeAsync(connectivity.POLL_INTERVAL_MS);
    expect(onTrigger).not.toHaveBeenCalled();
  });

  it("可視復帰時は即時に呼び出し、ポーリングを再開する", async () => {
    const connectivity: ConnectivityCheck =
      await import("#lib/client/sse/connectivity-check.js");
    const onTrigger = vi.fn();
    cleanup = connectivity.startConnectivityTriggers(onTrigger);
    visibilityState = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    visibilityState = "visible";
    document.dispatchEvent(new Event("visibilitychange"));
    expect(onTrigger).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(connectivity.POLL_INTERVAL_MS);
    expect(onTrigger).toHaveBeenCalledTimes(2);
  });

  it("online イベントで呼び出す", async () => {
    const connectivity: ConnectivityCheck =
      await import("#lib/client/sse/connectivity-check.js");
    const onTrigger = vi.fn();
    cleanup = connectivity.startConnectivityTriggers(onTrigger);
    window.dispatchEvent(new Event("online"));

    expect(onTrigger).toHaveBeenCalledTimes(1);
  });

  it("停止関数の実行後はすべての契機を解除する", async () => {
    const connectivity: ConnectivityCheck =
      await import("#lib/client/sse/connectivity-check.js");
    const onTrigger = vi.fn();
    cleanup = connectivity.startConnectivityTriggers(onTrigger);
    cleanup();
    cleanup = undefined;
    visibilityState = "hidden";
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("online"));
    await vi.advanceTimersByTimeAsync(connectivity.POLL_INTERVAL_MS);

    expect(onTrigger).not.toHaveBeenCalled();
  });
});
