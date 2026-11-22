import type { GetActiveTasksResult, TaskListItem } from "#lib/types.ts";
import { matchesShowType } from "#lib/show-type.ts";

export type ActiveTasksCache = Pick<GetActiveTasksResult, "serverTime"> & {
  tasks: TaskListItem[];
};

export function createTempTaskId(): number {
  return -Date.now();
}

export function isTempTaskId(id: number): boolean {
  return id <= 0;
}

export function mergeActiveTasks(
  prev: ActiveTasksCache | undefined,
  response: GetActiveTasksResult,
): ActiveTasksCache {
  if (!prev || response.mode === "full") {
    return {
      tasks: response.tasks.map((task) => ({ ...task, _key: task.id })),
      serverTime: response.serverTime,
    };
  }

  const responseMap = new Map(response.tasks.map((t) => [t.id, t]));
  const prevIds = new Set(prev.tasks.map((t) => t.id));

  const merged = prev.tasks.map((t) => {
    const updated = responseMap.get(t.id);
    return updated ? { ...updated, _key: t._key } : t;
  });

  for (const t of response.tasks) {
    if (!prevIds.has(t.id)) {
      merged.push({ ...t, _key: t.id });
    }
  }

  return { tasks: merged, serverTime: response.serverTime };
}

export function sortByTaskOrder(tasks: TaskListItem[]): TaskListItem[] {
  return [...tasks].sort((a, b) => {
    if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
    return a.id - b.id;
  });
}

export function filterByList(
  tasks: TaskListItem[],
  listId: number,
  showType: "active" | "archived" | "all",
): TaskListItem[] {
  return tasks.filter((t) => {
    if (t.listId !== listId) return false;
    return matchesShowType(t.status, showType);
  });
}
