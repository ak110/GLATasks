/**
 * @fileoverview task-cache ユーティリティのテスト
 */

import { describe, it, expect } from "vitest";
import type { TaskListItem } from "./types";
import {
  mergeActiveTasks,
  sortByListAndOrder,
  filterByList,
  type ActiveTasksCache,
} from "./task-cache";

function makeTask(overrides: Partial<TaskListItem> = {}): TaskListItem {
  const id = overrides.id ?? 1;
  return {
    _key: id,
    id,
    listId: 1,
    title: "テストタスク",
    notes: "",
    status: "active",
    kind: "normal",
    tags: [],
    sort_order: 0,
    updated: "2024-01-01T00:00:00.000Z",
    attachments: [],
    ...overrides,
  };
}

describe("mergeActiveTasks", () => {
  it("prev が undefined の場合は応答タスクをそのまま採用する", () => {
    const result = mergeActiveTasks(undefined, {
      tasks: [makeTask({ id: 1 }), makeTask({ id: 2 })],
      serverTime: "2024-01-02T01:00:00.000Z",
      mode: "full",
    });
    expect(result.tasks.map((t) => t.id)).toEqual([1, 2]);
    expect(result.serverTime).toBe("2024-01-02T01:00:00.000Z");
  });

  it("full モードはサーバー応答で全件上書きする", () => {
    const prev: ActiveTasksCache = {
      tasks: [makeTask({ id: 1 }), makeTask({ id: 2 })],
      serverTime: "2024-01-01T00:00:00.000Z",
    };
    const result = mergeActiveTasks(prev, {
      tasks: [makeTask({ id: 3 })],
      serverTime: "2024-01-02T01:00:00.000Z",
      mode: "full",
    });
    expect(result.tasks.map((t) => t.id)).toEqual([3]);
    expect(result.serverTime).toBe("2024-01-02T01:00:00.000Z");
  });

  it("delta モードは既存タスクを upsert し新規タスクを追加する", () => {
    const prev: ActiveTasksCache = {
      tasks: [makeTask({ id: 1, title: "旧タイトル" }), makeTask({ id: 2 })],
      serverTime: "2024-01-01T00:00:00.000Z",
    };
    const result = mergeActiveTasks(prev, {
      tasks: [makeTask({ id: 1, title: "新タイトル" }), makeTask({ id: 3 })],
      serverTime: "2024-01-02T01:00:00.000Z",
      mode: "delta",
    });
    expect(result.tasks.map((t) => t.id)).toEqual([1, 2, 3]);
    expect(result.tasks.find((t) => t.id === 1)?.title).toBe("新タイトル");
    expect(result.serverTime).toBe("2024-01-02T01:00:00.000Z");
  });

  it("delta モードで prev が undefined の場合は応答タスクをそのまま採用する", () => {
    const result = mergeActiveTasks(undefined, {
      tasks: [makeTask({ id: 1 }), makeTask({ id: 2 })],
      serverTime: "2024-01-02T01:00:00.000Z",
      mode: "delta",
    });
    expect(result.tasks.map((t) => t.id)).toEqual([1, 2]);
  });

  it("delta モードのupsertでは prev 側の _key を保持する", () => {
    // 楽観追加直後: id は実ID（onSuccess 反映後）に、_key は仮IDのまま残る状況。
    const tempKey = -1700000000000;
    const prev: ActiveTasksCache = {
      tasks: [makeTask({ id: 10, _key: tempKey, title: "旧" })],
      serverTime: "2024-01-01T00:00:00.000Z",
    };
    const result = mergeActiveTasks(prev, {
      tasks: [makeTask({ id: 10, _key: 10, title: "新" })],
      serverTime: "2024-01-02T01:00:00.000Z",
      mode: "delta",
    });
    expect(result.tasks).toHaveLength(1);
    expect(result.tasks[0]._key).toBe(tempKey);
    expect(result.tasks[0].title).toBe("新");
  });
});

describe("sortByListAndOrder", () => {
  it("sort_order 昇順に並べる", () => {
    const tasks = [
      makeTask({ id: 1, sort_order: 2000 }),
      makeTask({ id: 2, sort_order: 1000 }),
      makeTask({ id: 3, sort_order: 3000 }),
    ];
    const sorted = sortByListAndOrder(tasks);
    expect(sorted.map((t) => t.id)).toEqual([2, 1, 3]);
  });

  it("sort_order が同値の場合は id 昇順に並べる", () => {
    const tasks = [
      makeTask({ id: 3, sort_order: 1000 }),
      makeTask({ id: 1, sort_order: 1000 }),
      makeTask({ id: 2, sort_order: 1000 }),
    ];
    const sorted = sortByListAndOrder(tasks);
    expect(sorted.map((t) => t.id)).toEqual([1, 2, 3]);
  });

  it("元の配列を変更しない", () => {
    const tasks = [
      makeTask({ id: 2, sort_order: 2000 }),
      makeTask({ id: 1, sort_order: 1000 }),
    ];
    sortByListAndOrder(tasks);
    expect(tasks[0].id).toBe(2);
  });
});

describe("filterByList", () => {
  it("listId で抽出する", () => {
    const tasks = [
      makeTask({ id: 1, listId: 1 }),
      makeTask({ id: 2, listId: 2 }),
    ];
    const result = filterByList(tasks, 1, "all");
    expect(result.map((t) => t.id)).toEqual([1]);
  });

  it("showType=active は archived 以外を返す", () => {
    const tasks = [
      makeTask({ id: 1, status: "active" }),
      makeTask({ id: 2, status: "completed" }),
      makeTask({ id: 3, status: "archived" }),
    ];
    const result = filterByList(tasks, 1, "active");
    expect(result.map((t) => t.id)).toEqual([1, 2]);
  });

  it("showType=archived は archived のみを返す", () => {
    const tasks = [
      makeTask({ id: 1, status: "active" }),
      makeTask({ id: 2, status: "archived" }),
    ];
    const result = filterByList(tasks, 1, "archived");
    expect(result.map((t) => t.id)).toEqual([2]);
  });

  it("showType=all は全件を返す", () => {
    const tasks = [
      makeTask({ id: 1, status: "active" }),
      makeTask({ id: 2, status: "archived" }),
    ];
    const result = filterByList(tasks, 1, "all");
    expect(result.map((t) => t.id)).toEqual([1, 2]);
  });
});
