import type { QueryClient, QueryKey } from "@tanstack/svelte-query";
import { SSE_EVENTS, type SseEventName } from "#lib/sse-events.ts";
import { subscribeOnMount } from "#lib/client/sse/sse-subscribe.ts";
import { queryKeys } from "./query-options.ts";

/** 接続通知とheartbeatはデータ変更を表さない。resetの全再取得は接続管理が所有する。 */
export const eventQueryKeys: Record<
  SseEventName | "connected" | "heartbeat",
  readonly QueryKey[]
> = {
  [SSE_EVENTS.listsUpdated]: [queryKeys.lists],
  [SSE_EVENTS.tasksUpdated]: [
    queryKeys.activeTasks,
    queryKeys.tasks,
    queryKeys.lists,
    queryKeys.search,
  ],
  [SSE_EVENTS.schedulesUpdated]: [queryKeys.schedules],
  [SSE_EVENTS.timersUpdated]: [queryKeys.timers],
  [SSE_EVENTS.caloriesUpdated]: [queryKeys.calories],
  [SSE_EVENTS.usersPreferencesUpdated]: [
    queryKeys.preferences,
    queryKeys.calorieSummary,
  ],
  [SSE_EVENTS.reset]: [],
  connected: [],
  heartbeat: [],
};

export async function invalidateEventQueries(
  client: QueryClient,
  event: SseEventName,
): Promise<void> {
  await Promise.all(
    eventQueryKeys[event].map((queryKey) =>
      client.invalidateQueries({ queryKey }),
    ),
  );
}

export function subscribeQueryEvents(
  client: QueryClient,
  events: readonly SseEventName[],
) {
  subscribeOnMount(
    Object.fromEntries(
      events.map((event) => {
        const invalidate = () => invalidateEventQueries(client, event);
        return [event, { handler: invalidate, fallback: invalidate }];
      }),
    ),
  );
}
