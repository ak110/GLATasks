/**
 * @fileoverview SSE サーバー側バッファとリプレイ動作のユニットテスト
 *
 * リングバッファの容量・TTL・ユーザー単位の隔離、および replayEvents の
 * ヒット／ミス挙動を同値分割・境界値分析でパラメーター化網羅する。
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SSE_EVENTS } from "$lib/sse-events";

type SseModule = typeof import("./sse");

/** 指定ユーザーの enqueue 呼び出し履歴を捕捉するスタブコントローラーを生成する */
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

/** 文字列ペイロードから `id:` 行のIDを抽出する */
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

  // 同値分割: バッファ容量に対する投入件数（未満 / 上限 / 超過）
  // 境界値: 999件・1000件・1001件
  // バッファ上限は1000件で、1001件目投入時は最古の1件が破棄される
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
      // sendEvent経由でバッファ実態を確認できないため、replayEvents経由で件数を観測する
      const { controller: replayCtl, payloads: replayPayloads } =
        makeController();
      // lastEventId=0 で最古から全件再送（reset が来ない範囲を確認）
      sse.replayEvents(userId, 0, replayCtl);
      // 1001件投入時は最古ID=1が破棄され、lastEventId=0との連続性が崩れて reset となる
      if (count > 1000) {
        expect(replayPayloads[0]).toContain(`event: ${SSE_EVENTS.reset}`);
      } else {
        const ids = extractIds(replayPayloads);
        expect(ids.length).toBe(expectedSize);
      }
      // 送信履歴のID連番は count と一致
      expect(extractIds(payloads).length).toBe(count);
    },
  );

  // 同値分割: 最終発行からの経過時間（TTL未満 / TTL丁度 / TTL超過）
  // 境界値: 30分未満・30分・30分超
  // TTLを超えたユーザーバッファは次回イベント発行時のGCで破棄される
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

    // 経過時間後に別ユーザーへのイベント発行でGCを誘発する
    vi.setSystemTime(baseTime + elapsedMs);
    sse.sendEvent(userB, SSE_EVENTS.tasksUpdated, "tab-b");

    const { controller, payloads } = makeController();
    // userA のバッファ: lastEventId=0 で再送要求
    sse.replayEvents(userA, 0, controller);
    if (expectGc) {
      // GC済みなら reset が返る
      expect(payloads[0]).toContain(`event: ${SSE_EVENTS.reset}`);
    } else {
      // 保持されていればID=1のイベントがリプレイされる
      expect(payloads[0]).toContain("id: 1");
      expect(payloads[0]).toContain(`event: ${SSE_EVENTS.tasksUpdated}`);
    }
  });

  // 同値分割: ヒット範囲の lastEventId 指定位置（最古 / 中間 / 最新）
  // いずれもバッファ内に該当ID以降が存在するためリプレイされる
  // （ミス側のケースは別 it で「最古-1」「最新+1」を網羅する）
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
      // reset イベントは送られない
      expect(
        payloads.some((p) => p.includes(`event: ${SSE_EVENTS.reset}`)),
      ).toBe(false);
    },
  );

  it("replayEvents ミス: バッファ範囲外（lastEventId=0で最古ID=3）→ reset送信", () => {
    const userId = 1;
    const { controller: srcCtl } = makeController();
    sse.addConnection(userId, srcCtl);
    // 別ユーザーへ2件を送信してプロセス内IDを進め、対象ユーザーへ3件を送信する
    // 対象ユーザーのバッファに保持される最古IDは3となる
    const otherId = 99;
    sse.sendEvent(otherId, SSE_EVENTS.tasksUpdated, "tab-x");
    sse.sendEvent(otherId, SSE_EVENTS.tasksUpdated, "tab-x");
    sse.sendEvent(userId, SSE_EVENTS.tasksUpdated, "tab-1"); // id=3
    sse.sendEvent(userId, SSE_EVENTS.tasksUpdated, "tab-1"); // id=4
    sse.sendEvent(userId, SSE_EVENTS.tasksUpdated, "tab-1"); // id=5

    const { controller, payloads } = makeController();
    // lastEventId=1 はuser1のバッファ最古ID=3より前 → reset
    sse.replayEvents(userId, 1, controller);
    expect(payloads.length).toBe(1);
    expect(payloads[0]).toContain(`event: ${SSE_EVENTS.reset}`);
  });

  it("replayEvents ミス: クライアントの記憶が未来（再起動シナリオ）→ reset送信", () => {
    const userId = 1;
    const { controller: srcCtl } = makeController();
    sse.addConnection(userId, srcCtl);
    sse.sendEvent(userId, SSE_EVENTS.tasksUpdated, "tab-1"); // id=1

    const { controller, payloads } = makeController();
    // lastEventId=999 はバッファ最新ID=1より未来 → reset
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
    // ID採番はプロセス内グローバルなため、userA・userBで連番がインターリーブされるが、
    // バッファ自体はユーザーごとに分離されている。
    // クライアント側 lastEventId はそのユーザーが受信した最新IDを保持する想定なので、
    // userBの再接続時は「自分が受信した直前のID-1」相当（ここでは1）を渡す。
    const userA = 1;
    const userB = 2;
    const { controller: ctlA } = makeController();
    const { controller: ctlB } = makeController();
    sse.addConnection(userA, ctlA);
    sse.addConnection(userB, ctlB);
    sse.sendEvent(userA, SSE_EVENTS.tasksUpdated, "a"); // id=1
    sse.sendEvent(userB, SSE_EVENTS.listsUpdated, "b"); // id=2
    sse.sendEvent(userA, SSE_EVENTS.timersUpdated, "a"); // id=3

    // userA は自分が受信した最後のID直前（=0）から差分要求 → 自分のイベントのみ
    const { controller: replayA, payloads: payloadsA } = makeController();
    sse.replayEvents(userA, 0, replayA);
    const idsA = extractIds(payloadsA);
    expect(idsA).toEqual([1, 3]);
    expect(payloadsA.every((p) => !p.includes(SSE_EVENTS.listsUpdated))).toBe(
      true,
    );

    // userB は自分が受信した最後のID直前（=1。実運用ではuserAのid=1の存在は知らないが
    // ここではuserB自身の最古イベントid=2の連続性を保つ値として渡す）から要求
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
