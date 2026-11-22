import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

type Recovery = typeof import("#lib/client/sse/connection-recovery.svelte.ts");

const { loadHiddenFrame } = vi.hoisted(() => ({
  loadHiddenFrame: vi.fn(async () => {}),
}));
vi.mock("#lib/client/sse/silent-pass.ts", () => ({ loadHiddenFrame }));

function makeFetch(opts: {
  status?: number;
  contentType?: string;
  body?: string;
  reject?: boolean;
  timeout?: boolean;
  redirect?: boolean;
}): typeof fetch {
  if (opts.redirect) {
    return vi.fn(async () => ({
      type: "opaqueredirect",
      status: 0,
      headers: new Headers(),
    })) as unknown as typeof fetch;
  }
  if (opts.timeout) {
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

function focusElement(tag: "input" | "textarea" | "select"): void {
  const el = document.createElement(tag);
  document.body.appendChild(el);
  el.focus();
}

function sequenceFetch(...fetches: (typeof fetch)[]): typeof fetch {
  let index = 0;
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const current = fetches[Math.min(index, fetches.length - 1)];
    index += 1;
    return current(input, init);
  }) as unknown as typeof fetch;
}

async function holdUnrestorableDraft(): Promise<void> {
  const { holdUnsavedDraft } = await import("#lib/client/ui/user-busy.ts");
  holdUnsavedDraft();
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
    {
      label: "応答の横取り（認証画面へのリダイレクト）",
      fetch: makeFetch({ redirect: true }),
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
    const fetch = sequenceFetch(makeFetch({ reject: true }));
    vi.stubGlobal("fetch", fetch);
    recovery.startConnectivityWatch();
    try {
      await recovery.checkConnectivity();
      await vi.advanceTimersByTimeAsync(recovery.UNREACHABLE_NOTICE_DELAY_MS);
      expect(recovery.connectivityState.notice).toBe("unreachable");

      visibility.mockReturnValue("hidden");
      document.dispatchEvent(new Event("visibilitychange"));
      expect(recovery.connectivityState.notice).toBe("none");
      const callsAtHidden = vi.mocked(fetch).mock.calls.length;
      await vi.advanceTimersByTimeAsync(
        recovery.UNREACHABLE_RECHECK_INTERVAL_MS * 3,
      );
      expect(fetch).toHaveBeenCalledTimes(callsAtHidden);

      visibility.mockReturnValue("visible");
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(0);
      expect(fetch).toHaveBeenCalledTimes(callsAtHidden + 1);
      expect(recovery.connectivityState.notice).toBe("none");

      await vi.advanceTimersByTimeAsync(recovery.UNREACHABLE_NOTICE_DELAY_MS);
      expect(recovery.connectivityState.notice).toBe("unreachable");
    } finally {
      recovery.stopConnectivityWatch();
      vi.unstubAllGlobals();
    }
  });

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
    "未保存の内容がない応答の横取り: $label → 案内なしで再読み込み",
    async ({ setup }) => {
      setup();
      const recovery: Recovery =
        await import("#lib/client/sse/connection-recovery.svelte.ts");
      await recovery.checkConnectivity(makeFetch({ status: 511 }));

      expect(reloadMock).toHaveBeenCalledOnce();
      expect(recovery.connectivityState.notice).toBe("none");
    },
  );

  it("退避できる入力では案内を出さず、再読み込み後に入力を一度だけ復元する", async () => {
    sessionStorage.clear();
    const drafts = await import("#lib/client/ui/user-busy.ts");
    const stopTracking = drafts.startEditedFieldTracking();
    const onRestored = vi.fn();
    const stopRecovery = drafts.startDraftRecovery(() => 1, onRestored);
    try {
      const field = document.createElement("textarea");
      field.id = "draft";
      document.body.appendChild(field);
      field.value = "下書き";
      field.dispatchEvent(new Event("input", { bubbles: true }));

      const recovery =
        await import("#lib/client/sse/connection-recovery.svelte.ts");
      await recovery.checkConnectivity(makeFetch({ status: 511 }));
      expect(reloadMock).toHaveBeenCalledOnce();
      expect(recovery.connectivityState.notice).toBe("none");

      stopRecovery();
      field.remove();
      const restoredField = document.createElement("textarea");
      restoredField.id = "draft";
      document.body.appendChild(restoredField);
      const stopRestoration = drafts.startDraftRecovery(() => 1, onRestored);
      try {
        expect(restoredField.value).toBe("下書き");
        expect(onRestored).toHaveBeenCalledOnce();
        expect(sessionStorage.length).toBe(0);
      } finally {
        stopRestoration();
      }
    } finally {
      stopRecovery();
      stopTracking();
      sessionStorage.clear();
    }
  });

  it("入力中の応答の横取り後、回復検知で案内が自動解除される", async () => {
    await holdUnrestorableDraft();
    const recovery: Recovery =
      await import("#lib/client/sse/connection-recovery.svelte.ts");

    await recovery.checkConnectivity(makeFetch({ status: 511 }));
    expect(recovery.connectivityState.notice).toBe("reload-required");

    await recovery.checkConnectivity(makeFetch({}));
    expect(recovery.connectivityState.notice).toBe("none");
    expect(reloadMock).not.toHaveBeenCalled();
  });

  it("判定区分を返し、判定の実行中に重ねた呼出しは同じ判定を共有する", async () => {
    const recovery: Recovery =
      await import("#lib/client/sse/connection-recovery.svelte.ts");
    const fetch = makeFetch({
      contentType: "text/html",
      body: "<html>login</html>",
    });
    const [first, second] = await Promise.all([
      recovery.checkConnectivity(fetch),
      recovery.checkConnectivity(fetch),
    ]);
    expect([first, second]).toEqual(["intercepted", "intercepted"]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(await recovery.checkConnectivity(makeFetch({}))).toBe("healthy");
  });

  describe("横取りの自動通過", () => {
    it("非表示の読み込みで通過して健全に戻れば、再読み込みせず案内を消して回復を通知する", async () => {
      const recovery: Recovery =
        await import("#lib/client/sse/connection-recovery.svelte.ts");
      const recovered = vi.fn();
      window.addEventListener(recovery.CONNECTIVITY_RECOVERED_EVENT, recovered);
      const fetch = sequenceFetch(makeFetch({ status: 511 }), makeFetch({}));

      expect(await recovery.checkConnectivity(fetch)).toBe("intercepted");

      expect(loadHiddenFrame).toHaveBeenCalledTimes(1);
      expect(reloadMock).not.toHaveBeenCalled();
      expect(recovery.connectivityState.notice).toBe("none");
      expect(recovered).toHaveBeenCalledTimes(1);
      window.removeEventListener(
        recovery.CONNECTIVITY_RECOVERED_EVENT,
        recovered,
      );
    });

    it("通過を試す間に到達不能へ変われば、再読み込みせず到達不能の扱いへ進む", async () => {
      const recovery: Recovery =
        await import("#lib/client/sse/connection-recovery.svelte.ts");
      const fetch = sequenceFetch(
        makeFetch({ status: 511 }),
        makeFetch({ reject: true }),
      );

      expect(await recovery.checkConnectivity(fetch)).toBe("unreachable");

      expect(reloadMock).not.toHaveBeenCalled();
      expect(recovery.connectivityState.notice).toBe("none");
    });

    it("通過しなければ従来の回復誘導へ進み、直後の横取りでは通過を試し直さない", async () => {
      const recovery: Recovery =
        await import("#lib/client/sse/connection-recovery.svelte.ts");
      const fetch = makeFetch({ status: 511 });

      await recovery.checkConnectivity(fetch);
      expect(reloadMock).toHaveBeenCalledTimes(1);
      await recovery.checkConnectivity(fetch);

      expect(loadHiddenFrame).toHaveBeenCalledTimes(1);
      expect(reloadMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("認証画面の別ウィンドウ", () => {
    function stubAuthWindow(): {
      closed: boolean;
      close: ReturnType<typeof vi.fn>;
      focus: ReturnType<typeof vi.fn>;
    } {
      const authWindow = {
        closed: false,
        close: vi.fn(() => {
          authWindow.closed = true;
        }),
        focus: vi.fn(),
      };
      return authWindow;
    }

    async function interceptWhileTyping(): Promise<Recovery> {
      await holdUnrestorableDraft();
      const recovery: Recovery =
        await import("#lib/client/sse/connection-recovery.svelte.ts");
      await recovery.checkConnectivity(makeFetch({ status: 511 }));
      expect(recovery.connectivityState.notice).toBe("reload-required");
      return recovery;
    }

    it("開いた後の再判定で健全になると、別ウィンドウを閉じて案内を消す", async () => {
      const recovery = await interceptWhileTyping();
      const authWindow = stubAuthWindow();
      const openMock = vi
        .spyOn(window, "open")
        .mockReturnValue(authWindow as unknown as Window);
      const fetch = sequenceFetch(
        makeFetch({ contentType: "text/html", body: "<html>login</html>" }),
        makeFetch({}),
      );

      recovery.openAuthWindow(fetch);
      expect(openMock).toHaveBeenCalledWith("/healthcheck", "glatasks-auth");

      await vi.advanceTimersByTimeAsync(
        recovery.UNREACHABLE_RECHECK_INTERVAL_MS,
      );
      expect(authWindow.close).not.toHaveBeenCalled();
      expect(recovery.connectivityState.notice).toBe("reload-required");

      await vi.advanceTimersByTimeAsync(
        recovery.UNREACHABLE_RECHECK_INTERVAL_MS,
      );
      expect(authWindow.close).toHaveBeenCalledTimes(1);
      expect(recovery.connectivityState.notice).toBe("none");
      expect(reloadMock).not.toHaveBeenCalled();
    });

    it("到達不能の案内から開いた場合も、再判定で健全になると別ウィンドウを閉じて案内を消す", async () => {
      const recovery: Recovery =
        await import("#lib/client/sse/connection-recovery.svelte.ts");
      await recovery.checkConnectivity(
        sequenceFetch(makeFetch({ reject: true })),
      );
      await vi.advanceTimersByTimeAsync(recovery.UNREACHABLE_NOTICE_DELAY_MS);
      expect(recovery.connectivityState.notice).toBe("unreachable");

      const authWindow = stubAuthWindow();
      vi.spyOn(window, "open").mockReturnValue(authWindow as unknown as Window);
      recovery.openAuthWindow(makeFetch({}));
      await vi.advanceTimersByTimeAsync(
        recovery.UNREACHABLE_RECHECK_INTERVAL_MS,
      );

      expect(authWindow.close).toHaveBeenCalledTimes(1);
      expect(recovery.connectivityState.notice).toBe("none");
      expect(reloadMock).not.toHaveBeenCalled();
    });

    it("利用者が別ウィンドウを閉じた後は再判定を止め、案内を残す", async () => {
      const recovery = await interceptWhileTyping();
      const authWindow = stubAuthWindow();
      vi.spyOn(window, "open").mockReturnValue(authWindow as unknown as Window);
      const fetch = makeFetch({});

      recovery.openAuthWindow(fetch);
      authWindow.closed = true;
      await vi.advanceTimersByTimeAsync(
        recovery.UNREACHABLE_RECHECK_INTERVAL_MS * 3,
      );

      expect(fetch).not.toHaveBeenCalled();
      expect(recovery.connectivityState.notice).toBe("reload-required");
    });

    it("到達不能追跡と認証監視が共存し、停止後の判定完了では両方とも再開しない", async () => {
      const recovery = await interceptWhileTyping();
      const authWindow = stubAuthWindow();
      vi.spyOn(window, "open").mockReturnValue(authWindow as unknown as Window);
      const late = Promise.withResolvers<Response>();
      const fetch = vi
        .fn<typeof globalThis.fetch>()
        .mockRejectedValueOnce(new TypeError("network error"))
        .mockReturnValue(late.promise);
      vi.stubGlobal("fetch", fetch);
      recovery.startConnectivityWatch();
      try {
        recovery.openAuthWindow(fetch);
        await vi.advanceTimersByTimeAsync(
          recovery.UNREACHABLE_RECHECK_INTERVAL_MS,
        );
        expect(vi.getTimerCount()).toBe(3);
        await vi.advanceTimersByTimeAsync(
          recovery.UNREACHABLE_RECHECK_INTERVAL_MS,
        );
        expect(fetch).toHaveBeenCalledTimes(2);
        recovery.stopConnectivityWatch();
        late.reject(new TypeError("still offline"));
        await vi.advanceTimersByTimeAsync(recovery.UNREACHABLE_NOTICE_DELAY_MS);
        expect(fetch).toHaveBeenCalledTimes(2);
        expect(vi.getTimerCount()).toBe(0);
        expect(authWindow.close).toHaveBeenCalledOnce();
        expect(recovery.connectivityState.notice).toBe("none");
      } finally {
        recovery.stopConnectivityWatch();
        vi.unstubAllGlobals();
      }
    });

    it("ポップアップが阻止されて開けなかった場合は再判定を始めない", async () => {
      const recovery = await interceptWhileTyping();
      vi.spyOn(window, "open").mockReturnValue(null);
      const fetch = makeFetch({});

      recovery.openAuthWindow(fetch);
      await vi.advanceTimersByTimeAsync(
        recovery.UNREACHABLE_RECHECK_INTERVAL_MS * 3,
      );

      expect(fetch).not.toHaveBeenCalled();
      expect(recovery.connectivityState.notice).toBe("reload-required");
    });
  });
});
