import { QueryClient } from "@tanstack/svelte-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import { timersOptions } from "./query-options.ts";
import { eventQueryKeys, invalidateEventQueries } from "./query-sync.ts";
import { getServerOffset } from "./timers/time-sync.ts";

const { listTimers } = vi.hoisted(() => ({ listTimers: vi.fn() }));
vi.mock("#lib/client/trpc.ts", () => ({
  trpc: { timers: { list: { query: listTimers } } },
}));
vi.mock("#lib/client/sse/sse-subscribe.ts", () => ({
  subscribeOnMount: vi.fn(),
}));

afterEach(() => vi.restoreAllMocks());

describe("クエリーの取得と同期", () => {
  it("タイマー取得の往復時間の中点でサーバー時刻を補正する", async () => {
    vi.spyOn(Date, "now").mockReturnValueOnce(1000).mockReturnValueOnce(1400);
    const result = { server_time: new Date(2000).toISOString(), timers: [] };
    listTimers.mockResolvedValueOnce(result);
    expect(await timersOptions().queryFn()).toBe(result);
    expect(getServerOffset()).toBe(800);
  });

  it("タスク変更は一覧・検索を含めて再取得し、接続通知では再取得しない", async () => {
    const client = new QueryClient();
    const invalidate = vi
      .spyOn(client, "invalidateQueries")
      .mockResolvedValue();
    await invalidateEventQueries(client, "tasks:updated");
    expect(invalidate.mock.calls.map(([options]) => options?.queryKey)).toEqual(
      [["activeTasks"], ["tasks"], ["lists"], ["search"]],
    );
    expect(eventQueryKeys.connected).toEqual([]);
    expect(eventQueryKeys.heartbeat).toEqual([]);
  });
});
