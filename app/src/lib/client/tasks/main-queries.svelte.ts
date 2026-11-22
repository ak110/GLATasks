import { createQuery, type QueryClient } from "@tanstack/svelte-query";
import {
  activeTasksOptions,
  archivedTasksOptions,
  archiveTagCandidatesOptions,
  listsOptions,
  searchOptions,
  queryKeys,
} from "#lib/client/query-options.ts";
import type { MainState } from "./main-state.svelte.ts";

export function createMainQueries(queryClient: QueryClient, state: MainState) {
  const listsQuery = createQuery(() => listsOptions(state.showType));
  const tasksQuery = createQuery(() => activeTasksOptions(queryClient));
  const archivedTasksQuery = createQuery(() => ({
    ...archivedTasksOptions(state.selectedListId, state.archivePage),
    enabled:
      state.showType === "archived" &&
      state.selectedListId !== null &&
      state.searchQuery.length === 0,
  }));
  const archiveTagCandidatesQuery = createQuery(() => ({
    ...archiveTagCandidatesOptions(state.selectedListId),
    enabled:
      state.showType === "archived" &&
      state.selectedListId !== null &&
      (state.addTaskText.length > 0 || state.dialogs.editDialog.open),
  }));
  const searchResultsQuery = createQuery(() => ({
    ...searchOptions(
      state.debouncedQuery,
      state.showType,
      state.selectedListId,
      state.searchPage,
    ),
    enabled:
      state.debouncedQuery.length > 0 &&
      state.debouncedQuery === state.searchQuery,
  }));
  $effect(() => {
    const data = archivedTasksQuery.data;
    if (data?.page === state.archivePage && !archivedTasksQuery.isFetching) {
      state.archivePage = Math.min(state.archivePage, lastPage(data));
    }
  });
  $effect(() => {
    const data = searchResultsQuery.data;
    if (
      data?.page === state.searchPage &&
      !searchResultsQuery.isFetching &&
      state.searchQuery === state.debouncedQuery
    ) {
      state.searchPage = Math.min(state.searchPage, lastPage(data));
    }
  });
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
    archiveTagCandidatesQuery,
    searchResultsQuery,
    resetActiveTasks,
  };
}

function lastPage(data: { total: number; pageSize: number }) {
  return Math.max(0, Math.ceil(data.total / data.pageSize) - 1);
}
