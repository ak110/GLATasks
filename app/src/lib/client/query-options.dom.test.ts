import { QueryClient } from "@tanstack/svelte-query";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  activeTasksOptions,
  queryKeys,
  timersOptions,
} from "./query-options.ts";
import { eventQueryKeys, invalidateEventQueries } from "./query-sync.ts";
import { getServerOffset } from "./timers/time-sync.ts";

const { listTimers, listActiveTasks } = vi.hoisted(() => ({
  listTimers: vi.fn(),
  listActiveTasks: vi.fn(),
}));
vi.mock("#lib/client/trpc.ts", () => ({
  trpc: {
    timers: { list: { query: listTimers } },
    tasks: { listActive: { query: listActiveTasks } },
  },
}));
vi.mock("#lib/client/sse/sse-subscribe.ts", () => ({
  subscribeOnMount: vi.fn(),
}));

afterEach(() => vi.restoreAllMocks());

describe("クエリーの取得と同期", () => {
  it("接続復旧のリセット後は以前の差分カーソルを送らず全件取得する", async () => {
    const client = new QueryClient();
    client.setQueryData(queryKeys.activeTasks, {
      tasks: [],
      serverTime: "2026-01-01T00:00:00.000Z",
    });
    listActiveTasks.mockResolvedValue({
      mode: "full",
      tasks: [],
      serverTime: "2026-01-02T00:00:00.000Z",
    });
    await client.resetQueries();
    await client.fetchQuery(activeTasksOptions(client));
    expect(listActiveTasks).toHaveBeenCalledWith({ since: undefined });
    expect(client.getQueryData(queryKeys.activeTasks)).toEqual({
      tasks: [],
      serverTime: "2026-01-02T00:00:00.000Z",
    });
    client.clear();
  });

  it("リスト変更は保存先リストを参照する検索結果も再取得する", async () => {
    const client = new QueryClient();
    const invalidate = vi
      .spyOn(client, "invalidateQueries")
      .mockResolvedValue();
    await invalidateEventQueries(client, "lists:updated");
    expect(invalidate.mock.calls.map(([options]) => options?.queryKey)).toEqual(
      [["lists"], ["search"]],
    );
    client.clear();
  });
  it("タイマー取得の往復時間の中点でサーバー時刻を補正する", async () => {
    vi.spyOn(Date, "now").mockReturnValueOnce(1000).mockReturnValueOnce(1400);
    const result = { serverTime: new Date(2000).toISOString(), timers: [] };
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
