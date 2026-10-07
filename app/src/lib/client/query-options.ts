import type { QueryClient } from "@tanstack/svelte-query";
import { trpc } from "#lib/client/trpc.ts";
import {
  mergeActiveTasks,
  type ActiveTasksCache,
} from "#lib/client/tasks/task-cache.ts";
import { setServerOffset } from "#lib/client/timers/time-sync.ts";

type ShowType = "active" | "archived" | "all";
export const queryKeys = {
  lists: ["lists"] as const,
  list: (showType: ShowType) => ["lists", showType] as const,
  activeTasks: ["activeTasks"] as const,
  tasks: ["tasks"] as const,
  archivedTasks: (listId: number | null) =>
    ["tasks", listId, "archived"] as const,
  search: ["search"] as const,
  searchResults: (query: string, showType: ShowType) =>
    ["search", query, showType] as const,
  schedules: ["schedules"] as const,
  listSchedules: (listId: number | null) => ["schedules", listId] as const,
  timers: ["timers"] as const,
  preferences: ["user-preferences"] as const,
  calories: ["calories"] as const,
  calorieItems: ["calories", "items"] as const,
  calorieAutoRecords: ["calories", "auto-records"] as const,
  calorieRecords: (windowOffset: number, tzOffset: number) =>
    ["calories", "records", windowOffset, tzOffset] as const,
  calorieSummary: ["calories", "summary"] as const,
  calorieSummaryAt: (tzOffset: number) =>
    ["calories", "summary", tzOffset] as const,
};

export const listsOptions = (showType: ShowType) => ({
  queryKey: queryKeys.list(showType),
  queryFn: () => trpc.lists.list.query(showType),
});
export const activeTasksOptions = (client: QueryClient) => ({
  queryKey: queryKeys.activeTasks,
  queryFn: async () => {
    const previous = client.getQueryData<ActiveTasksCache>(
      queryKeys.activeTasks,
    );
    return mergeActiveTasks(
      previous,
      await trpc.tasks.listActive.query({ since: previous?.serverTime }),
    );
  },
  staleTime: Infinity,
});
export const archivedTasksOptions = (listId: number | null) => ({
  queryKey: queryKeys.archivedTasks(listId),
  queryFn: () =>
    trpc.tasks.list.query({ listId: listId!, showType: "archived" }),
});
export const searchOptions = (query: string, showType: ShowType) => ({
  queryKey: queryKeys.searchResults(query, showType),
  queryFn: () => trpc.tasks.search.query({ query, showType }),
});
export const schedulesOptions = (listId: number | null) => ({
  queryKey: queryKeys.listSchedules(listId),
  queryFn: () => trpc.schedules.list.query({ listId: listId! }),
  enabled: listId !== null,
});
export const preferencesOptions = () => ({
  queryKey: queryKeys.preferences,
  queryFn: () => trpc.users.getPreferences.query(),
});
export const timersOptions = () => ({
  queryKey: queryKeys.timers,
  queryFn: async () => {
    const started = Date.now();
    const result = await trpc.timers.list.query();
    setServerOffset(
      new Date(result.server_time).getTime() - (started + Date.now()) / 2,
    );
    return result;
  },
});
export const calorieItemsOptions = () => ({
  queryKey: queryKeys.calorieItems,
  queryFn: () => trpc.calories.items.query(),
});
export const calorieAutoRecordsOptions = () => ({
  queryKey: queryKeys.calorieAutoRecords,
  queryFn: () => trpc.calories.autoRecords.query(),
});
export const calorieRecordsOptions = (
  windowOffset: number,
  tzOffset: number,
) => ({
  queryKey: queryKeys.calorieRecords(windowOffset, tzOffset),
  queryFn: () =>
    trpc.calories.records.query({
      window_offset: windowOffset,
      tz_offset_minutes: tzOffset,
    }),
});
export const calorieSummaryOptions = (tzOffset: number) => ({
  queryKey: queryKeys.calorieSummaryAt(tzOffset),
  queryFn: () => trpc.calories.summary.query({ tz_offset_minutes: tzOffset }),
});
