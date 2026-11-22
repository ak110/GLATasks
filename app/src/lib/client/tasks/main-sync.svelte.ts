import { SvelteMap } from "svelte/reactivity";
import { queryKeys } from "#lib/client/query-options.ts";
import { invalidateEventQueries } from "#lib/client/query-sync.ts";
import type { QueryClient } from "@tanstack/svelte-query";
import { tabId, type RouterOutputs } from "#lib/client/trpc.ts";
import { subscribeOnMount } from "#lib/client/sse/sse-subscribe.ts";
import { SSE_EVENTS } from "#lib/sse-events.ts";
import { debugLog } from "#lib/client/debug-log.ts";
import type { ActiveTasksCache } from "#lib/client/tasks/task-cache.ts";
import type { MainState } from "./main-state.svelte.ts";

export function subscribeMainSync(
  queryClient: QueryClient,
  state: MainState,
  resetActiveTasks: () => Promise<void>,
) {
  async function syncLists(): Promise<void> {
    debugLog("sync", "lists");
    const prevLists =
      queryClient.getQueryData<RouterOutputs["lists"]["list"]>(
        queryKeys.list(state.showType),
      ) ?? [];
    const prevKey = JSON.stringify(
      prevLists.map((l) => `${l.id}:${l.status}`).sort(),
    );
    await invalidateEventQueries(queryClient, SSE_EVENTS.listsUpdated);
    const newLists =
      queryClient.getQueryData<RouterOutputs["lists"]["list"]>(
        queryKeys.list(state.showType),
      ) ?? [];
    const newKey = JSON.stringify(
      newLists.map((l) => `${l.id}:${l.status}`).sort(),
    );
    if (prevKey !== newKey) {
      debugLog("sync", "lists-reset-cache");
      await resetActiveTasks();
    }
  }

  async function syncTasks(fromOwnTab: boolean): Promise<void> {
    debugLog("sync", "tasks", { fromOwnTab });
    const oldCache = queryClient.getQueryData<ActiveTasksCache>(
      queryKeys.activeTasks,
    );
    const oldMap = new SvelteMap(
      (oldCache?.tasks ?? []).map((t) => [
        t.id,
        `${t.title}\0${t.notes}\0${t.status}`,
      ]),
    );
    await invalidateEventQueries(queryClient, SSE_EVENTS.tasksUpdated);
    if (fromOwnTab) return;
    const newCache = queryClient.getQueryData<ActiveTasksCache>(
      queryKeys.activeTasks,
    );
    for (const task of newCache?.tasks ?? []) {
      const oldKey = oldMap.get(task.id);
      const newKey = `${task.title}\0${task.notes}\0${task.status}`;
      if (oldKey === undefined || oldKey !== newKey) {
        state.updatedTaskIds.add(task.id);
      }
    }
  }

  async function syncSchedules(): Promise<void> {
    debugLog("sync", "schedules");
    await invalidateEventQueries(queryClient, SSE_EVENTS.schedulesUpdated);
  }

  subscribeOnMount({
    [SSE_EVENTS.listsUpdated]: {
      handler: () => {
        void syncLists();
      },
      fallback: syncLists,
    },
    [SSE_EVENTS.tasksUpdated]: {
      handler: (e) => {
        const fromOwnTab = e.data === tabId;
        debugLog("sync", "tasks-received", {
          fromOwnTab,
          sourceTabId: e.data,
        });
        void syncTasks(fromOwnTab);
      },
      fallback: () => syncTasks(false),
    },
    [SSE_EVENTS.schedulesUpdated]: {
      handler: () => {
        void syncSchedules();
      },
      fallback: syncSchedules,
    },
  });
}
