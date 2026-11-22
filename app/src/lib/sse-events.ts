export const SSE_EVENTS = {
  connected: "connected",
  heartbeat: "heartbeat",
  listsUpdated: "lists:updated",
  tasksUpdated: "tasks:updated",
  timersUpdated: "timers:updated",
  usersPreferencesUpdated: "users:preferences:updated",
  schedulesUpdated: "schedules:updated",
  caloriesUpdated: "calories:updated",
  reset: "reset",
} as const;

export type SseEventName = (typeof SSE_EVENTS)[keyof typeof SSE_EVENTS];
