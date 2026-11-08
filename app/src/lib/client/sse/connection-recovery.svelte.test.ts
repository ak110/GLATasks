/**
 * @fileoverview 能動検出とリロード経路のユニットテスト
 *
 * `checkConnectivity` の判定区分ごとの回復誘導（再読み込みか案内か）、到達不能の継続時間による案内の表示、
 * 到達不能の間の短い間隔の再判定、検知後の入力中／非入力中分岐、回復時の案内の自動解除を同値分割でカバーする。
 * `fetch` は引数注入で差し替え、`location.reload` のみグローバルを差し替える。時間経過はfake timersで制御する。
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

/** 呼ばれるたびに次の応答を返すfetchスタブ。末尾に達したら最後の応答を返し続ける */
function sequenceFetch(...fetches: (typeof fetch)[]): typeof fetch {
  let index = 0;
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const current = fetches[Math.min(index, fetches.length - 1)];
    index += 1;
    return current(input, init);
  }) as unknown as typeof fetch;
}

describe("connection-recovery", () => {
  let reloadMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.resetModules();
    vi.useFakeTimers();
    reloadMock = vi.fn();
    Object.defineProperty(window.location, "reload", {
      configurable: true,
      value: reloadMock,
    });
    document.body.innerHTML = "";
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  // 接続判定の詳細な同値分割は connectivity-check.dom.test.ts が担う。
  // ここでは判定の3区分ごとの1回目の判定直後の回復誘導を、各区分の代表値で検証する。
  // 到達不能は猶予の間は案内しない（継続時の案内は別のテストで検証する）。
  it.each([
    {
      label: "健全（200・JSON・ok）",
      fetch: makeFetch({}),
      expectReload: false,
    },
    {
      label: "到達不能（通信エラー）",
      fetch: makeFetch({ reject: true }),
      expectReload: false,
    },
    {
      label: "到達不能（タイムアウト）",
      fetch: makeFetch({ timeout: true }),
      expectReload: false,
    },
    {
      label: "到達不能（502）",
      fetch: makeFetch({ status: 502 }),
      expectReload: false,
    },
    {
      label: "到達不能（503）",
      fetch: makeFetch({ status: 503 }),
      expectReload: false,
    },
    {
      label: "応答の横取り（511）",
      fetch: makeFetch({ status: 511 }),
      expectReload: true,
    },
    {
      label: "応答の横取り（200・text/html）",
      fetch: makeFetch({
        contentType: "text/html",
        body: "<html>login</html>",
      }),
      expectReload: true,
    },
  ])(
    "非入力中 checkConnectivity: $label → reload=$expectReload、案内なし",
    async ({ fetch, expectReload }) => {
      const recovery: Recovery =
        await import("#lib/client/sse/connection-recovery.svelte.ts");
      await recovery.checkConnectivity(fetch);

      if (expectReload) {
        expect(reloadMock).toHaveBeenCalledTimes(1);
      } else {
        expect(reloadMock).not.toHaveBeenCalled();
      }
      expect(recovery.connectivityState.notice).toBe("none");
    },
  );

  it("到達不能が猶予を超えて続くと、再読み込みボタンのない到達不能の案内を出し、回復の検知で解除する", async () => {
    const recovery: Recovery =
      await import("#lib/client/sse/connection-recovery.svelte.ts");
    const fetch = sequenceFetch(makeFetch({ reject: true }));
    await recovery.checkConnectivity(fetch);
    expect(recovery.connectivityState.notice).toBe("none");

    // 2秒間隔の再判定を猶予（6秒）まで進めると案内が出る
    await vi.advanceTimersByTimeAsync(recovery.UNREACHABLE_NOTICE_DELAY_MS);
    expect(fetch).toHaveBeenCalledTimes(
      1 +
        recovery.UNREACHABLE_NOTICE_DELAY_MS /
          recovery.UNREACHABLE_RECHECK_INTERVAL_MS,
    );
    expect(recovery.connectivityState.notice).toBe("unreachable");

    await recovery.checkConnectivity(makeFetch({}));
    expect(recovery.connectivityState.notice).toBe("none");
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it("到達不能の後、猶予の間に回復すれば案内を出さず、次の再判定で健全を検知して再判定を止める", async () => {
    const recovery: Recovery =
      await import("#lib/client/sse/connection-recovery.svelte.ts");
    const fetch = sequenceFetch(makeFetch({ reject: true }), makeFetch({}));
    await recovery.checkConnectivity(fetch);
    expect(fetch).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(recovery.UNREACHABLE_RECHECK_INTERVAL_MS);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(recovery.connectivityState.notice).toBe("none");

    // 健全を検知した後は短い間隔の再判定を続けない
    await vi.advanceTimersByTimeAsync(
      recovery.UNREACHABLE_RECHECK_INTERVAL_MS * 5,
    );
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it("非表示の間は再判定せず、非表示の間の通信断を可視復帰後の猶予に含めない", async () => {
    const recovery: Recovery =
      await import("#lib/client/sse/connection-recovery.svelte.ts");
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden");
    const fetch = sequenceFetch(makeFetch({ reject: true }));
    await recovery.checkConnectivity(fetch);
    await vi.advanceTimersByTimeAsync(recovery.UNREACHABLE_NOTICE_DELAY_MS * 2);
    expect(fetch).toHaveBeenCalledTimes(1);

    // 可視復帰直後の判定も到達不能だが、猶予を数え直すため案内はまだ出さない
    visibility.mockReturnValue("visible");
    await recovery.checkConnectivity(fetch);
    expect(recovery.connectivityState.notice).toBe("none");
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it("案内の表示中に非表示へ移ると案内と再判定を打ち切り、可視復帰後は新しい猶予の後にだけ案内する", async () => {
    const recovery: Recovery =
      await import("#lib/client/sse/connection-recovery.svelte.ts");
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("visible");
    // 監視のトリガー（可視復帰）は既定のfetchで判定するため、グローバルのfetchを到達不能へ差し替える
    const fetch = sequenceFetch(makeFetch({ reject: true }));
    vi.stubGlobal("fetch", fetch);
    recovery.startConnectivityWatch();
    try {
      await recovery.checkConnectivity();
      await vi.advanceTimersByTimeAsync(recovery.UNREACHABLE_NOTICE_DELAY_MS);
      expect(recovery.connectivityState.notice).toBe("unreachable");

      // 非表示へ移った時点で案内を消し、予約済みの再判定も通信しない
      visibility.mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      expect(recovery.connectivityState.notice).toBe("none");
      const callsAtHidden = vi.mocked(fetch).mock.calls.length;
      await vi.advanceTimersByTimeAsync(
        recovery.UNREACHABLE_RECHECK_INTERVAL_MS * 3,
      );
      expect(fetch).toHaveBeenCalledTimes(callsAtHidden);

      // 可視復帰の判定でもまだ到達不能だが、非表示前の継続時間を持ち越さないため案内しない
      visibility.mockReturnValue("visible");
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
      expect(fetch).toHaveBeenCalledTimes(callsAtHidden + 1);
      expect(recovery.connectivityState.notice).toBe("none");

      // 新しい可視期間で猶予を超えて続いた場合だけ案内する
      await vi.advanceTimersByTimeAsync(recovery.UNREACHABLE_NOTICE_DELAY_MS);
      expect(recovery.connectivityState.notice).toBe("unreachable");
    } finally {
      recovery.stopConnectivityWatch();
      vi.unstubAllGlobals();
    }
  });

  // 同値分割: 入力中判定パターン。応答の横取りでも入力中は reload せず、再読み込みを求める案内で待機する。
  // 到達不能（503など）は入力中かどうかを判定せずに案内の判断へ進むため、入力中の判定を通る横取りの代表値（511）を使う。
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
  ])(
    "入力中の応答の横取り: $label → 再読み込みを求める案内",
    async ({ setup }) => {
      setup();
      const recovery: Recovery =
        await import("#lib/client/sse/connection-recovery.svelte.ts");
      await recovery.checkConnectivity(makeFetch({ status: 511 }));

      expect(reloadMock).not.toHaveBeenCalled();
      expect(recovery.connectivityState.notice).toBe("reload-required");
    },
  );

  it("入力中の応答の横取り後、回復検知で案内が自動解除される", async () => {
    focusElement("textarea");
    const recovery: Recovery =
      await import("#lib/client/sse/connection-recovery.svelte.ts");

    await recovery.checkConnectivity(makeFetch({ status: 511 }));
    expect(recovery.connectivityState.notice).toBe("reload-required");

    // 回復検知で案内を自動解除する（入力中のため reload はしない）
    await recovery.checkConnectivity(makeFetch({}));
    expect(recovery.connectivityState.notice).toBe("none");
    expect(reloadMock).not.toHaveBeenCalled();
  });
});
