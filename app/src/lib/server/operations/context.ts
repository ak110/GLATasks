import { sendEvent } from "../sse";
import type { SseEventName } from "#lib/sse-events.ts";

export interface OperationContext {
  userId: number;
  tabId?: string | null;
}

export function notify(
  ctx: OperationContext,
  events: readonly SseEventName[],
): void {
  for (const event of events) sendEvent(ctx.userId, event, ctx.tabId);
}
