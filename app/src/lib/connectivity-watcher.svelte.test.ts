/**
 * @fileoverview キャプティブポータル監視のユニットテスト
 *
 * fetch・タイマー・visibilityState・activeElement・location.reload を
 * 差し替え可能な範囲でモックする。sse-client.test.ts のパターンに合わせ、
 * 同値分割・境界値分析で抽出したケースを `it.each` でパラメーター化する。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const POLL_INTERVAL_MS = 60_000;

type Watcher = typeof import("./connectivity-watcher.svelte");

/** 指定値を返す getter で document.visibilityState を差し替える */
function setVisibility(value: DocumentVisibilityState): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => value,
  });
}

/** JSON ヘルスチェック応答を生成する（既定: 200 + application/json） */
function jsonResponse(
  body: object,
  init?: { status?: number; contentType?: string },
): Response {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: { "Content-Type": init?.contentType ?? "application/json" },
  });
}

/** 成功応答（status:"ok"） */
function okResponse(): Response {
  return jsonResponse({ status: "ok" });
}

/** 指定回数だけポーリング周期を進め、setInterval コールバックと内部 fetch を解決させる */
async function tickPoll(times = 1): Promise<void> {
  for (let i = 0; i < times; i++) {
    await vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS);
  }
}

describe("connectivity-watcher", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  let reloadMock: ReturnType<typeof vi.fn>;
  // テスト本体での assertion 失敗時にも確実に stop() を呼んで
  // visibilitychange リスナーを解除するため、afterEach から参照可能な所に保持する
  let currentWatcher: Watcher | null = null;

  beforeEach(() => {
    vi.useFakeTimers();
    vi.resetModules();
    fetchMock = vi.fn();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    reloadMock = vi.fn();
    Object.defineProperty(window.location, "reload", {
      configurable: true,
      value: reloadMock,
    });
    setVisibility("visible");
    document.body.innerHTML = "";
    currentWatcher = null;
  });

  afterEach(() => {
    currentWatcher?.stop();
    currentWatcher = null;
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  // 同値分割: 1回のヘルスチェック結果（失敗 / 成功）
  // 連続失敗カウントは撤廃済みで、1回失敗で即発火・1回成功で発火しないことを確認する
  it.each([
    {
      label: "失敗",
      respond: (mock: ReturnType<typeof vi.fn>) =>
        mock.mockResolvedValueOnce(jsonResponse({ status: "ng" })),
      expectReload: true,
    },
    {
      label: "成功",
      respond: (mock: ReturnType<typeof vi.fn>) =>
        mock.mockResolvedValueOnce(okResponse()),
      expectReload: false,
    },
  ])(
    "ヘルスチェック1回 $label → reload発火=$expectReload",
    async ({ respond, expectReload }) => {
      respond(fetchMock);
      // 後続ポーリングは安定して成功扱い
      fetchMock.mockResolvedValue(okResponse());

      currentWatcher = await import("./connectivity-watcher.svelte");
      currentWatcher.start();
      await tickPoll(1);

      if (expectReload) {
        expect(reloadMock).toHaveBeenCalledTimes(1);
      } else {
        expect(reloadMock).not.toHaveBeenCalled();
      }
    },
  );

  // 同値分割: 検知時の入力中判定パターン
  // 非入力中は即時 reload、入力中は pendingReload=true でバナー待機に分岐する
  it.each([
    {
      label: "非入力中（フォーカスなし・ダイアログなし）",
      setup: () => {},
      expectReload: true,
      expectPending: false,
    },
    {
      label: "INPUT 要素にフォーカス",
      setup: () => {
        const el = document.createElement("input");
        document.body.appendChild(el);
        el.focus();
      },
      expectReload: false,
      expectPending: true,
    },
    {
      label: "TEXTAREA 要素にフォーカス",
      setup: () => {
        const el = document.createElement("textarea");
        document.body.appendChild(el);
        el.focus();
      },
      expectReload: false,
      expectPending: true,
    },
    {
      label: "contenteditable 要素にフォーカス",
      setup: () => {
        const el = document.createElement("div");
        el.setAttribute("contenteditable", "true");
        document.body.appendChild(el);
        el.focus();
      },
      expectReload: false,
      expectPending: true,
    },
    {
      label: 'role="dialog" aria-modal="true" 要素が存在',
      setup: () => {
        const el = document.createElement("div");
        el.setAttribute("role", "dialog");
        el.setAttribute("aria-modal", "true");
        document.body.appendChild(el);
      },
      expectReload: false,
      expectPending: true,
    },
  ])(
    "検知時の分岐: $label → reload=$expectReload / pendingReload=$expectPending",
    async ({ setup, expectReload, expectPending }) => {
      setup();
      fetchMock.mockResolvedValueOnce(jsonResponse({ status: "ng" }));
      fetchMock.mockResolvedValue(okResponse());

      currentWatcher = await import("./connectivity-watcher.svelte");
      currentWatcher.start();
      await tickPoll(1);

      if (expectReload) {
        expect(reloadMock).toHaveBeenCalledTimes(1);
      } else {
        expect(reloadMock).not.toHaveBeenCalled();
      }
      expect(currentWatcher.connectivityState.pendingReload).toBe(
        expectPending,
      );
    },
  );

  // 同値分割: 切断判定条件
  // fetch がネットワークエラー・HTTP ステータス 200 以外・Content-Type が
  // application/json 以外・JSON の status が "ok" 以外、いずれも失敗扱いで即発火
  it.each([
    {
      label: "ネットワークエラー",
      respond: (mock: ReturnType<typeof vi.fn>) =>
        mock.mockRejectedValueOnce(new TypeError("network error")),
      isFailure: true,
    },
    {
      label: "HTTPステータス500",
      respond: (mock: ReturnType<typeof vi.fn>) =>
        mock.mockResolvedValueOnce(
          jsonResponse({ status: "ok" }, { status: 500 }),
        ),
      isFailure: true,
    },
    {
      label: "200 + Content-Type: text/html",
      respond: (mock: ReturnType<typeof vi.fn>) =>
        mock.mockResolvedValueOnce(
          new Response("<html></html>", {
            status: 200,
            headers: { "Content-Type": "text/html" },
          }),
        ),
      isFailure: true,
    },
    {
      label: '200 + JSON status="ng"',
      respond: (mock: ReturnType<typeof vi.fn>) =>
        mock.mockResolvedValueOnce(jsonResponse({ status: "ng" })),
      isFailure: true,
    },
    {
      label: '200 + JSON status="ok"',
      respond: (mock: ReturnType<typeof vi.fn>) =>
        mock.mockResolvedValueOnce(okResponse()),
      isFailure: false,
    },
  ])(
    "判定条件: $label は失敗扱い=$isFailure（1回で即発火）",
    async ({ respond, isFailure }) => {
      respond(fetchMock);
      fetchMock.mockResolvedValue(okResponse());

      currentWatcher = await import("./connectivity-watcher.svelte");
      currentWatcher.start();
      await tickPoll(1);

      if (isFailure) {
        expect(reloadMock).toHaveBeenCalledTimes(1);
      } else {
        expect(reloadMock).not.toHaveBeenCalled();
      }
    },
  );

  it("hidden の間はポーリングを停止し、fetch を発火しない", async () => {
    fetchMock.mockResolvedValue(okResponse());

    setVisibility("hidden");
    currentWatcher = await import("./connectivity-watcher.svelte");
    currentWatcher.start();

    await tickPoll(3);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("visible へ復帰した瞬間に即時1回 fetch が発火する", async () => {
    fetchMock.mockResolvedValue(okResponse());

    setVisibility("hidden");
    currentWatcher = await import("./connectivity-watcher.svelte");
    currentWatcher.start();

    // hidden 中はポーリング停止のため fetch されない
    await tickPoll(2);
    expect(fetchMock).not.toHaveBeenCalled();

    setVisibility("visible");
    document.dispatchEvent(new Event("visibilitychange"));
    // visibilitychange ハンドラ内の `void checkHealth()` を解決する
    await vi.advanceTimersByTimeAsync(0);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
