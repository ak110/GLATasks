/**
 * @fileoverview 能動検出とリロード経路のユニットテスト
 *
 * `checkConnectivity` の3点判定（HTTPステータス200・`application/json`・本文 `status` 値 ok）と、
 * 検知後の入力中／非入力中分岐、回復時のバナー自動解除を同値分割でカバーする。
 * `fetch` は引数注入で差し替え、`location.reload` のみグローバルを差し替える。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type Recovery = typeof import("./connection-recovery.svelte");

/** 注入用の fetch スタブを生成する。`reject` 指定時はネットワークエラー相当で失敗させる */
function makeFetch(opts: {
  status?: number;
  contentType?: string;
  body?: string;
  reject?: boolean;
}): typeof fetch {
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

  // 同値分割: 3点判定の健全条件と各失敗条件。
  // 非入力中のため、不健全なら即時 reload、健全なら何もしない。
  it.each([
    {
      label: "健全（200・JSON・ok）",
      fetch: makeFetch({}),
      expectReload: false,
    },
    {
      label: "非200",
      fetch: makeFetch({ status: 503 }),
      expectReload: true,
    },
    {
      label: "非JSON（キャプティブポータルのHTML応答）",
      fetch: makeFetch({
        contentType: "text/html",
        body: "<html>login</html>",
      }),
      expectReload: true,
    },
    {
      label: "status 値が非ok",
      fetch: makeFetch({ body: '{"status":"error"}' }),
      expectReload: true,
    },
    {
      label: "fetch 例外（ネットワークエラー・タイムアウト相当）",
      fetch: makeFetch({ reject: true }),
      expectReload: true,
    },
  ])(
    "非入力中 checkConnectivity: $label → reload=$expectReload",
    async ({ fetch, expectReload }) => {
      const recovery: Recovery = await import("./connection-recovery.svelte");
      await recovery.checkConnectivity(fetch);

      if (expectReload) {
        expect(reloadMock).toHaveBeenCalledTimes(1);
      } else {
        expect(reloadMock).not.toHaveBeenCalled();
      }
      expect(recovery.connectivityState.pendingReload).toBe(false);
    },
  );

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
    const recovery: Recovery = await import("./connection-recovery.svelte");
    await recovery.checkConnectivity(makeFetch({ status: 503 }));

    expect(reloadMock).not.toHaveBeenCalled();
    expect(recovery.connectivityState.pendingReload).toBe(true);
  });

  it("入力中の不健全検知後、回復検知でバナーが自動解除される", async () => {
    focusElement("textarea");
    const recovery: Recovery = await import("./connection-recovery.svelte");

    // 不健全検知でバナー待機へ
    await recovery.checkConnectivity(makeFetch({ status: 503 }));
    expect(recovery.connectivityState.pendingReload).toBe(true);

    // 回復検知でバナーを自動解除する（入力中のため reload はしない）
    await recovery.checkConnectivity(makeFetch({}));
    expect(recovery.connectivityState.pendingReload).toBe(false);
    expect(reloadMock).not.toHaveBeenCalled();
  });
});
