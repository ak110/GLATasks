/**
 * @fileoverview 能動検出とリロード経路のユニットテスト
 *
 * `checkConnectivity` の3点判定（HTTPステータス200・`application/json`・本文 `status` 値 ok）と、
 * 検知後の入力中／非入力中分岐、回復時のバナー自動解除を同値分割でカバーする。
 * `fetch` は引数注入で差し替え、`location.reload` のみグローバルを差し替える。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type Recovery = typeof import("#lib/client/sse/connection-recovery.svelte.ts");

/** 注入用の fetch スタブを生成する。`reject` 指定時はネットワークエラー相当で失敗させる */
function makeFetch(opts: {
  status?: number;
  contentType?: string;
  body?: string;
  reject?: boolean;
  timeout?: boolean;
}): typeof fetch {
  if (opts.timeout) {
    // AbortSignal.timeoutの打ち切りと同じ種別の例外で失敗させる
    return vi.fn(() =>
      Promise.reject(new DOMException("timed out", "TimeoutError")),
    ) as unknown as typeof fetch;
  }
  if (opts.reject) {
    return vi.fn(() =>
      Promise.reject(new TypeError("network error")),
    ) as unknown as typeof fetch;
  }
  const {
    status = 200,
    contentType = "application/json",
    body = '{"status":"ok"}',
  } = opts;
  return vi.fn(
    async () =>
      new Response(body, { status, headers: { "Content-Type": contentType } }),
  ) as unknown as typeof fetch;
}

/** 指定要素を body に追加してフォーカスする */
function focusElement(tag: "input" | "textarea" | "select"): void {
  const el = document.createElement(tag);
  document.body.appendChild(el);
  el.focus();
}

describe("connection-recovery", () => {
  let reloadMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    reloadMock = vi.fn();
    Object.defineProperty(window.location, "reload", {
      configurable: true,
      value: reloadMock,
    });
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  // 接続判定の詳細な同値分割は connectivity-check.dom.test.ts が担う。
  // ここでは判定の3区分ごとの回復誘導（再読み込みかバナーか）を、各区分の代表値で検証する。
  it.each([
    {
      label: "健全（200・JSON・ok）",
      fetch: makeFetch({}),
      expectReload: false,
      expectBanner: false,
    },
    {
      label: "到達不能（通信エラー）",
      fetch: makeFetch({ reject: true }),
      expectReload: false,
      expectBanner: true,
    },
    {
      label: "到達不能（タイムアウト）",
      fetch: makeFetch({ timeout: true }),
      expectReload: false,
      expectBanner: true,
    },
    {
      label: "到達不能（502）",
      fetch: makeFetch({ status: 502 }),
      expectReload: false,
      expectBanner: true,
    },
    {
      label: "到達不能（503）",
      fetch: makeFetch({ status: 503 }),
      expectReload: false,
      expectBanner: true,
    },
    {
      label: "応答の横取り（511）",
      fetch: makeFetch({ status: 511 }),
      expectReload: true,
      expectBanner: false,
    },
    {
      label: "応答の横取り（200・text/html）",
      fetch: makeFetch({
        contentType: "text/html",
        body: "<html>login</html>",
      }),
      expectReload: true,
      expectBanner: false,
    },
  ])(
    "非入力中 checkConnectivity: $label → reload=$expectReload banner=$expectBanner",
    async ({ fetch, expectReload, expectBanner }) => {
      const recovery: Recovery =
        await import("#lib/client/sse/connection-recovery.svelte.ts");
      await recovery.checkConnectivity(fetch);

      if (expectReload) {
        expect(reloadMock).toHaveBeenCalledTimes(1);
      } else {
        expect(reloadMock).not.toHaveBeenCalled();
      }
      expect(recovery.connectivityState.pendingReload).toBe(expectBanner);
    },
  );

  it("非入力中の通信エラーでバナーを出し、回復の検知で再読み込みせず解除する", async () => {
    const recovery: Recovery =
      await import("#lib/client/sse/connection-recovery.svelte.ts");
    await recovery.checkConnectivity(makeFetch({ reject: true }));
    expect(recovery.connectivityState.pendingReload).toBe(true);
    await recovery.checkConnectivity(makeFetch({}));
    expect(recovery.connectivityState.pendingReload).toBe(false);
    expect(reloadMock).not.toHaveBeenCalled();
  });

  // 同値分割: 入力中判定パターン。不健全検知でも reload せず pendingReload=true でバナー待機する。
  it.each([
    { label: "INPUT 要素にフォーカス", setup: () => focusElement("input") },
    {
      label: "TEXTAREA 要素にフォーカス",
      setup: () => focusElement("textarea"),
    },
    { label: "SELECT 要素にフォーカス", setup: () => focusElement("select") },
    {
      label: "contenteditable 要素にフォーカス",
      setup: () => {
        const el = document.createElement("div");
        el.setAttribute("contenteditable", "true");
        document.body.appendChild(el);
        el.focus();
      },
    },
    {
      label: "ネイティブdialogが開いている（入力欄にフォーカスなし）",
      setup: () => {
        const dialog = document.createElement("dialog");
        document.body.appendChild(dialog);
        dialog.showModal();
      },
    },
    {
      label: 'role="dialog" aria-modal="true" 要素が存在',
      setup: () => {
        const el = document.createElement("div");
        el.setAttribute("role", "dialog");
        el.setAttribute("aria-modal", "true");
        document.body.appendChild(el);
      },
    },
  ])("入力中の不健全検知: $label → バナー表示", async ({ setup }) => {
    setup();
    const recovery: Recovery =
      await import("#lib/client/sse/connection-recovery.svelte.ts");
    await recovery.checkConnectivity(makeFetch({ status: 503 }));

    expect(reloadMock).not.toHaveBeenCalled();
    expect(recovery.connectivityState.pendingReload).toBe(true);
  });

  it("入力中の不健全検知後、回復検知でバナーが自動解除される", async () => {
    focusElement("textarea");
    const recovery: Recovery =
      await import("#lib/client/sse/connection-recovery.svelte.ts");

    // 不健全検知でバナー待機へ
    await recovery.checkConnectivity(makeFetch({ status: 503 }));
    expect(recovery.connectivityState.pendingReload).toBe(true);

    // 回復検知でバナーを自動解除する（入力中のため reload はしない）
    await recovery.checkConnectivity(makeFetch({}));
    expect(recovery.connectivityState.pendingReload).toBe(false);
    expect(reloadMock).not.toHaveBeenCalled();
  });
});
