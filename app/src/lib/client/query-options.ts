import type { QueryClient } from "@tanstack/svelte-query";
import { trpc, type RouterInputs } from "#lib/client/trpc.ts";
import {
  mergeActiveTasks,
  type ActiveTasksCache,
} from "#lib/client/tasks/task-cache.ts";
import { setServerOffset } from "#lib/client/timers/time-sync.ts";

type ShowType = RouterInputs["lists"]["list"];
export const queryKeys = {
  lists: ["lists"] as const,
  list: (showType: ShowType) => ["lists", showType] as const,
  activeTasks: ["activeTasks"] as const,
  tasks: ["tasks"] as const,
  archivedTasks: (listId: RouterInputs["tasks"]["list"]["listId"] | null) =>
    ["tasks", listId, "archived"] as const,
  search: ["search"] as const,
  searchResults: (
    query: RouterInputs["tasks"]["search"]["query"],
    showType: ShowType,
  ) => ["search", query, showType] as const,
  schedules: ["schedules"] as const,
  listSchedules: (listId: RouterInputs["schedules"]["list"]["listId"] | null) =>
    ["schedules", listId] as const,
  timers: ["timers"] as const,
  preferences: ["user-preferences"] as const,
  calories: ["calories"] as const,
  calorieItems: ["calories", "items"] as const,
  calorieAutoRecords: ["calories", "auto-records"] as const,
  calorieRecords: (
    windowOffset: NonNullable<
      RouterInputs["calories"]["records"]["windowOffset"]
    >,
    tzOffset: NonNullable<
      RouterInputs["calories"]["summary"]["tzOffsetMinutes"]
    >,
  ) => ["calories", "records", windowOffset, tzOffset] as const,
  calorieSummary: ["calories", "summary"] as const,
  calorieSummaryAt: (
    tzOffset: NonNullable<
      RouterInputs["calories"]["summary"]["tzOffsetMinutes"]
    >,
  ) => ["calories", "summary", tzOffset] as const,
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
export const archivedTasksOptions = (
  listId: RouterInputs["tasks"]["list"]["listId"] | null,
) => ({
  queryKey: queryKeys.archivedTasks(listId),
  queryFn: () =>
    trpc.tasks.list.query({ listId: listId!, showType: "archived" }),
});
export const searchOptions = (
  query: RouterInputs["tasks"]["search"]["query"],
  showType: ShowType,
) => ({
  queryKey: queryKeys.searchResults(query, showType),
  queryFn: () => trpc.tasks.search.query({ query, showType }),
});
export const schedulesOptions = (
  listId: RouterInputs["schedules"]["list"]["listId"] | null,
) => ({
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
      new Date(result.serverTime).getTime() - (started + Date.now()) / 2,
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
  windowOffset: NonNullable<
    RouterInputs["calories"]["records"]["windowOffset"]
  >,
  tzOffset: NonNullable<RouterInputs["calories"]["summary"]["tzOffsetMinutes"]>,
) => ({
  queryKey: queryKeys.calorieRecords(windowOffset, tzOffset),
  queryFn: () =>
    trpc.calories.records.query({
      windowOffset: windowOffset,
      tzOffsetMinutes: tzOffset,
    }),
});
export const calorieSummaryOptions = (
  tzOffset: NonNullable<RouterInputs["calories"]["summary"]["tzOffsetMinutes"]>,
) => ({
  queryKey: queryKeys.calorieSummaryAt(tzOffset),
  queryFn: () => trpc.calories.summary.query({ tzOffsetMinutes: tzOffset }),
});
