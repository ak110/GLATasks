import { createQuery, type QueryClient } from "@tanstack/svelte-query";
import {
  activeTasksOptions,
  archivedTasksOptions,
  listsOptions,
  searchOptions,
  queryKeys,
} from "#lib/client/query-options.ts";
import type { MainState } from "./main-state.svelte.ts";

export function createMainQueries(queryClient: QueryClient, state: MainState) {
  const listsQuery = createQuery(() => listsOptions(state.showType));
  const tasksQuery = createQuery(() => activeTasksOptions(queryClient));
  const archivedTasksQuery = createQuery(() => ({
    ...archivedTasksOptions(state.selectedListId),
    enabled: state.showType === "archived" && state.selectedListId !== null,
  }));
  const searchResultsQuery = createQuery(() => ({
    ...searchOptions(state.debouncedQuery, state.showType),
    enabled: state.debouncedQuery.length > 0,
  }));
  async function resetActiveTasks() {
    await queryClient.resetQueries({
      queryKey: queryKeys.activeTasks,
      exact: true,
    });
  }
  return {
    listsQuery,
    tasksQuery,
    archivedTasksQuery,
    searchResultsQuery,
    resetActiveTasks,
  };
}
