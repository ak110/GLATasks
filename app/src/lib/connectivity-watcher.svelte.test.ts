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

/** 連続失敗用の fetch モック設定 + 末尾に成功を1件積む */
function queueFailuresThenOk(
  fetchMock: ReturnType<typeof vi.fn>,
  failCount: number,
): void {
  for (let i = 0; i < failCount; i++) {
    fetchMock.mockResolvedValueOnce(jsonResponse({ status: "ng" }));
  }
  fetchMock.mockResolvedValueOnce(okResponse());
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

  // 同値分割: 連続失敗回数（閾値未満 / 閾値 / 閾値超過）
  // 境界値: 1回・2回・3回（FAILURE_THRESHOLD=2 の前後）
  // 連続2回失敗後の成功で復旧処理が走り、reload が呼ばれる
  it.each([
    { label: "1回失敗", failCount: 1, expectReload: false },
    { label: "2回失敗", failCount: 2, expectReload: true },
    { label: "3回失敗", failCount: 3, expectReload: true },
  ])(
    "連続失敗 $label 後の成功で復旧処理発火=$expectReload",
    async ({ failCount, expectReload }) => {
      queueFailuresThenOk(fetchMock, failCount);

      currentWatcher = await import("./connectivity-watcher.svelte");
      currentWatcher.start();
      await tickPoll(failCount + 1);

      if (expectReload) {
        expect(reloadMock).toHaveBeenCalledTimes(1);
      } else {
        expect(reloadMock).not.toHaveBeenCalled();
      }
    },
  );

  // 同値分割: 復旧時の入力中判定パターン
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
    "復旧時の分岐: $label → reload=$expectReload / pendingReload=$expectPending",
    async ({ setup, expectReload, expectPending }) => {
      setup();
      queueFailuresThenOk(fetchMock, 2);

      currentWatcher = await import("./connectivity-watcher.svelte");
      currentWatcher.start();
      await tickPoll(3);

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
  // application/json 以外・JSON の status が "ok" 以外、いずれも失敗扱い
  // 判定対象の応答を連続2回与え、3回目の成功で復旧発火するかを観測する
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
    "判定条件: $label は失敗扱い=$isFailure",
    async ({ respond, isFailure }) => {
      // 判定対象の応答を2回連続で積む（失敗扱いなら failureCount=2 で切断確定）
      respond(fetchMock);
      respond(fetchMock);
      // 3回目以降は成功扱い固定 → 失敗扱いケースのみ復旧発火
      fetchMock.mockResolvedValue(okResponse());

      currentWatcher = await import("./connectivity-watcher.svelte");
      currentWatcher.start();
      await tickPoll(3);

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
