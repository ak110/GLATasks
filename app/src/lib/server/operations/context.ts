import { sendEvent } from "../sse";
import type { SseEventName } from "#lib/sse-events.ts";

export interface OperationContext {
  userId: number;
  tabId?: string | null;
}

/** 操作の書き込みが成功した後に、影響した資源を通知する。 */
export function notify(
  ctx: OperationContext,
  events: readonly SseEventName[],
): void {
  for (const event of events) sendEvent(ctx.userId, event, ctx.tabId);
}
