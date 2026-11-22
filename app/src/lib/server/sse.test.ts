import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SSE_EVENTS } from "#lib/sse-events.ts";

type SseModule = typeof import("./sse");

function makeController(): {
  controller: ReadableStreamDefaultController;
  payloads: string[];
} {
  const payloads: string[] = [];
  const decoder = new TextDecoder();
  const controller = {
    enqueue: (chunk: Uint8Array) => {
      payloads.push(decoder.decode(chunk));
    },
  } as unknown as ReadableStreamDefaultController;
  return { controller, payloads };
}

function extractIds(payloads: string[]): number[] {
  const ids: number[] = [];
  for (const p of payloads) {
    const match = p.match(/^id: (\d+)$/m);
    if (match) ids.push(Number(match[1]));
  }
  return ids;
}

describe("SSEバッファとリプレイ", () => {
  let sse: SseModule;

  beforeEach(async () => {
    vi.resetModules();
    sse = await import("./sse");
    sse._resetForTest();
  });

  afterEach(() => {
    vi.useRealTimers();
    sse._resetForTest();
  });

  it.each([
    { label: "999件（容量未満）", count: 999, expectedSize: 999 },
    { label: "1000件（上限）", count: 1000, expectedSize: 1000 },
    { label: "1001件（容量超過）", count: 1001, expectedSize: 1000 },
  ])(
    "バッファ容量: $label → 保持件数=$expectedSize",
    ({ count, expectedSize }) => {
      const userId = 1;
      const { controller, payloads } = makeController();
      sse.addConnection(userId, controller);
      for (let i = 0; i < count; i++) {
        sse.sendEvent(userId, SSE_EVENTS.tasksUpdated, "tab-1");
      }
      const { controller: replayCtl, payloads: replayPayloads } =
        makeController();
      sse.replayEvents(userId, 0, replayCtl);
      if (count > 1000) {
        expect(replayPayloads[0]).toContain(`event: ${SSE_EVENTS.reset}`);
      } else {
        const ids = extractIds(replayPayloads);
        expect(ids.length).toBe(expectedSize);
      }
      expect(extractIds(payloads).length).toBe(count);
    },
  );

  it.each([
    {
      label: "29分59秒（TTL未満）",
      elapsedMs: 30 * 60 * 1000 - 1000,
      expectGc: false,
    },
    {
      label: "30分（TTL丁度）",
      elapsedMs: 30 * 60 * 1000,
      expectGc: false,
    },
    {
      label: "30分1秒（TTL超過）",
      elapsedMs: 30 * 60 * 1000 + 1000,
      expectGc: true,
    },
  ])("TTL GC: $label → 破棄=$expectGc", ({ elapsedMs, expectGc }) => {
    vi.useFakeTimers();
    const baseTime = new Date("2026-01-01T00:00:00Z").getTime();
    vi.setSystemTime(baseTime);

    const userA = 10;
    const userB = 20;
    sse.sendEvent(userA, SSE_EVENTS.tasksUpdated, "tab-a");

    vi.setSystemTime(baseTime + elapsedMs);
    sse.sendEvent(userB, SSE_EVENTS.tasksUpdated, "tab-b");

    const { controller, payloads } = makeController();
    sse.replayEvents(userA, 0, controller);
    if (expectGc) {
      expect(payloads[0]).toContain(`event: ${SSE_EVENTS.reset}`);
    } else {
      expect(payloads[0]).toContain("id: 1");
      expect(payloads[0]).toContain(`event: ${SSE_EVENTS.tasksUpdated}`);
    }
  });

  it.each([
    { label: "最古ID（=1）", lastEventId: 1, expectIds: [2, 3, 4, 5] },
    { label: "中間ID（=3）", lastEventId: 3, expectIds: [4, 5] },
    { label: "最新ID（=5）", lastEventId: 5, expectIds: [] as number[] },
  ])(
    "replayEvents ヒット: $label → 復元IDs=$expectIds",
    ({ lastEventId, expectIds }) => {
      const userId = 1;
      const { controller: srcCtl } = makeController();
      sse.addConnection(userId, srcCtl);
      for (let i = 0; i < 5; i++) {
        sse.sendEvent(userId, SSE_EVENTS.tasksUpdated, "tab-1");
      }

      const { controller, payloads } = makeController();
      sse.replayEvents(userId, lastEventId, controller);
      expect(extractIds(payloads)).toEqual(expectIds);
      expect(
        payloads.some((p) => p.includes(`event: ${SSE_EVENTS.reset}`)),
      ).toBe(false);
    },
  );

  it("replayEvents ミス: バッファ範囲外（lastEventId=0で最古ID=3）→ reset送信", () => {
    const userId = 1;
    const { controller: srcCtl } = makeController();
    sse.addConnection(userId, srcCtl);
    const otherId = 99;
    sse.sendEvent(otherId, SSE_EVENTS.tasksUpdated, "tab-x");
    sse.sendEvent(otherId, SSE_EVENTS.tasksUpdated, "tab-x");
    sse.sendEvent(userId, SSE_EVENTS.tasksUpdated, "tab-1");
    sse.sendEvent(userId, SSE_EVENTS.tasksUpdated, "tab-1");
    sse.sendEvent(userId, SSE_EVENTS.tasksUpdated, "tab-1");

    const { controller, payloads } = makeController();
    sse.replayEvents(userId, 1, controller);
    expect(payloads.length).toBe(1);
    expect(payloads[0]).toContain(`event: ${SSE_EVENTS.reset}`);
  });

  it("replayEvents ミス: クライアントの記憶が未来（再起動シナリオ）→ reset送信", () => {
    const userId = 1;
    const { controller: srcCtl } = makeController();
    sse.addConnection(userId, srcCtl);
    sse.sendEvent(userId, SSE_EVENTS.tasksUpdated, "tab-1");

    const { controller, payloads } = makeController();
    sse.replayEvents(userId, 999, controller);
    expect(payloads.length).toBe(1);
    expect(payloads[0]).toContain(`event: ${SSE_EVENTS.reset}`);
  });

  it("replayEvents ミス: バッファ未作成のユーザー → reset送信", () => {
    const { controller, payloads } = makeController();
    sse.replayEvents(404, 0, controller);
    expect(payloads.length).toBe(1);
    expect(payloads[0]).toContain(`event: ${SSE_EVENTS.reset}`);
  });

  it("ユーザー単位の隔離: 他ユーザーのバッファは混入しない", () => {
    const userA = 1;
    const userB = 2;
    const { controller: ctlA } = makeController();
    const { controller: ctlB } = makeController();
    sse.addConnection(userA, ctlA);
    sse.addConnection(userB, ctlB);
    sse.sendEvent(userA, SSE_EVENTS.tasksUpdated, "a");
    sse.sendEvent(userB, SSE_EVENTS.listsUpdated, "b");
    sse.sendEvent(userA, SSE_EVENTS.timersUpdated, "a");

    const { controller: replayA, payloads: payloadsA } = makeController();
    sse.replayEvents(userA, 0, replayA);
    const idsA = extractIds(payloadsA);
    expect(idsA).toEqual([1, 3]);
    expect(payloadsA.every((p) => !p.includes(SSE_EVENTS.listsUpdated))).toBe(
      true,
    );

    const { controller: replayB, payloads: payloadsB } = makeController();
    sse.replayEvents(userB, 1, replayB);
    const idsB = extractIds(payloadsB);
    expect(idsB).toEqual([2]);
  });

  it("sendEventはバッファ追記とfan-outを両方行う", () => {
    const userId = 1;
    const { controller: ctl1, payloads: p1 } = makeController();
    const { controller: ctl2, payloads: p2 } = makeController();
    sse.addConnection(userId, ctl1);
    sse.addConnection(userId, ctl2);

    sse.sendEvent(userId, SSE_EVENTS.tasksUpdated, "src-tab");

    expect(p1.length).toBe(1);
    expect(p2.length).toBe(1);
    expect(p1[0]).toContain("id: 1");
    expect(p1[0]).toContain(`event: ${SSE_EVENTS.tasksUpdated}`);
    expect(p1[0]).toContain("data: src-tab");
  });
});

describe("SSEのモジュール再評価をまたぐ接続と通知", () => {
  type EventsRoute = typeof import("../../routes/api/events/+server");

  async function loadGeneration(): Promise<{
    sse: SseModule;
    route: EventsRoute;
  }> {
    vi.resetModules();
    return {
      sse: await import("./sse"),
      route: await import("../../routes/api/events/+server"),
    };
  }

  async function connect(
    route: EventsRoute,
    userId: number,
    lastEventId?: number,
  ) {
    const url = new URL("http://localhost/api/events");
    const headers = new Headers();
    if (lastEventId !== undefined)
      headers.set("Last-Event-ID", String(lastEventId));
    const response = await route.GET({
      locals: { user_id: userId },
      request: new Request(url, { headers }),
      url,
    } as unknown as Parameters<EventsRoute["GET"]>[0]);
    const reader = response.body!.getReader();
    const decoder = new TextDecoder();
    return {
      async next(): Promise<string> {
        const { value } = await reader.read();
        return decoder.decode(value);
      },
      cancel: () => reader.cancel(),
    };
  }

  beforeEach(async () => {
    (await import("./process-state"))._resetProcessStateForTest();
  });

  afterEach(async () => {
    vi.useRealTimers();
    (await import("./process-state"))._resetProcessStateForTest();
  });

  it("再評価前の接続へ再評価後の通知が届き、採番が継続する", async () => {
    const before = await loadGeneration();
    const stream = await connect(before.route, 1);
    expect(await stream.next()).toContain(`event: ${SSE_EVENTS.connected}`);
    before.sse.sendEvent(1, SSE_EVENTS.tasksUpdated, "old");
    expect(await stream.next()).toContain("id: 1");

    const after = await loadGeneration();
    after.sse.sendEvent(1, SSE_EVENTS.listsUpdated, "new");
    const received = await stream.next();
    expect(received).toContain("id: 2");
    expect(received).toContain(`event: ${SSE_EVENTS.listsUpdated}`);
    await stream.cancel();
  });

  it("再評価後の接続が再評価前のバッファからLast-Event-ID以降を再送する", async () => {
    const before = await loadGeneration();
    for (let i = 0; i < 3; i++)
      before.sse.sendEvent(1, SSE_EVENTS.tasksUpdated, "old");

    const after = await loadGeneration();
    const stream = await connect(after.route, 1, 1);
    const replayed = await stream.next();
    expect(extractIds([replayed])).toEqual([2]);
    expect(extractIds([await stream.next()])).toEqual([3]);
    await stream.cancel();
  });

  it("再評価前のバッファの上限とTTLを再評価後の通知が適用する", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));
    const before = await loadGeneration();
    for (let i = 0; i < 1000; i++)
      before.sse.sendEvent(1, SSE_EVENTS.tasksUpdated, "old");
    before.sse.sendEvent(2, SSE_EVENTS.tasksUpdated, "old");

    const after = await loadGeneration();
    after.sse.sendEvent(1, SSE_EVENTS.tasksUpdated, "new");
    const limit = makeController();
    after.sse.replayEvents(1, 0, limit.controller);
    expect(limit.payloads[0]).toContain(`event: ${SSE_EVENTS.reset}`);
    const kept = makeController();
    after.sse.replayEvents(1, 1, kept.controller);
    expect(extractIds(kept.payloads)).toHaveLength(1000);

    vi.setSystemTime(new Date("2026-01-01T00:30:01Z"));
    after.sse.sendEvent(3, SSE_EVENTS.tasksUpdated, "new");
    const expired = makeController();
    after.sse.replayEvents(2, 1000, expired.controller);
    expect(expired.payloads[0]).toContain(`event: ${SSE_EVENTS.reset}`);
  });

  it("再評価前の接続を再評価後の処理で解除すると、以後の通知は届かない", async () => {
    const before = await loadGeneration();
    const { controller, payloads } = makeController();
    before.sse.addConnection(1, controller);

    const after = await loadGeneration();
    after.sse.removeConnection(1, controller);
    after.sse.sendEvent(1, SSE_EVENTS.tasksUpdated, "new");
    expect(payloads).toEqual([]);
  });
});
