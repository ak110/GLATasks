import type { RequestHandler } from "./$types";
import {
  addConnection,
  removeConnection,
  replayEvents,
  formatEvent,
} from "#lib/server/sse.ts";
import { SSE_EVENTS } from "#lib/sse-events.ts";

export const GET: RequestHandler = async ({ locals, request, url }) => {
  const userId = locals.user_id;
  if (!userId) {
    return new Response("Unauthorized: log in at /auth/login and reconnect.", {
      status: 401,
    });
  }

  const lastEventId = parseLastEventId(
    request.headers.get("Last-Event-ID"),
    url.searchParams.get("lastEventId"),
  );

  let savedController: ReadableStreamDefaultController | null = null;
  let heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      savedController = controller;
      addConnection(userId, controller);
      if (lastEventId !== null) {
        replayEvents(userId, lastEventId, controller);
      } else {
        controller.enqueue(
          new TextEncoder().encode(
            formatEvent(undefined, SSE_EVENTS.connected, String(Date.now())),
          ),
        );
      }
      heartbeatInterval = setInterval(() => {
        try {
          controller.enqueue(
            new TextEncoder().encode(
              formatEvent(undefined, SSE_EVENTS.heartbeat, String(Date.now())),
            ),
          );
        } catch {}
      }, 30_000);
    },
    cancel() {
      if (heartbeatInterval) clearInterval(heartbeatInterval);
      if (savedController) removeConnection(userId, savedController);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    },
  });
};

function parseLastEventId(
  headerValue: string | null,
  queryValue: string | null,
): number | null {
  const raw = headerValue ?? queryValue;
  if (raw === null || raw === "") return null;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) return null;
  return parsed;
}
