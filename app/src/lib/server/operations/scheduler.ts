import { notify } from "./context";
import { SSE_EVENTS } from "#lib/sse-events.ts";

export function notifyScheduleExecution(userId: number): void {
  notify({ userId }, [SSE_EVENTS.tasksUpdated, SSE_EVENTS.schedulesUpdated]);
}

export function notifyCalorieExecution(userId: number): void {
  notify({ userId }, [SSE_EVENTS.caloriesUpdated]);
}
