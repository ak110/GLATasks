import type { SseEventName } from "#lib/sse-events.ts";
import { SSE_EVENTS } from "#lib/sse-events.ts";
import { processState } from "./process-state";

export type { SseEventName };

const encoder = new TextEncoder();

const BUFFER_MAX_EVENTS = 1000;

const BUFFER_TTL_MS = 30 * 60 * 1000;

interface BufferedEvent {
  id: number;
  type: SseEventName;
  sourceTabId: string;
}

interface UserBuffer {
  events: BufferedEvent[];
  lastTouchAt: number;
}

interface SseState {
  connections: Map<number, Set<ReadableStreamDefaultController>>;
  buffers: Map<number, UserBuffer>;
  nextEventId: number;
}

const state = processState<SseState>("sse", () => ({
  connections: new Map(),
  buffers: new Map(),
  nextEventId: 1,
}));
const { connections, buffers } = state;

export function addConnection(
  userId: number,
  controller: ReadableStreamDefaultController,
): void {
  let userConnections = connections.get(userId);
  if (!userConnections) {
    userConnections = new Set();
    connections.set(userId, userConnections);
  }
  userConnections.add(controller);
}

export function removeConnection(
  userId: number,
  controller: ReadableStreamDefaultController,
): void {
  const userConnections = connections.get(userId);
  if (!userConnections) return;
  userConnections.delete(controller);
  if (userConnections.size === 0) {
    connections.delete(userId);
  }
}

export function sendEvent(
  userId: number,
  eventType: SseEventName,
  sourceTabId?: string | null,
): void {
  const id = state.nextEventId++;
  appendToBuffer(userId, {
    id,
    type: eventType,
    sourceTabId: sourceTabId ?? "",
  });
  gcExpiredBuffers();

  const userConnections = connections.get(userId);
  if (!userConnections) return;
  const encoded = encoder.encode(formatEvent(id, eventType, sourceTabId ?? ""));
  for (const controller of userConnections) {
    try {
      controller.enqueue(encoded);
    } catch {}
  }
}

export function replayEvents(
  userId: number,
  lastEventId: number,
  controller: ReadableStreamDefaultController,
): void {
  const buffer = buffers.get(userId);
  const oldest = buffer?.events[0];
  const newest = buffer?.events[buffer.events.length - 1];
  if (
    !buffer ||
    !oldest ||
    !newest ||
    oldest.id > lastEventId + 1 ||
    newest.id < lastEventId
  ) {
    enqueueReset(controller);
    return;
  }
  const replayables = buffer.events.filter((e) => e.id > lastEventId);
  for (const event of replayables) {
    try {
      controller.enqueue(
        encoder.encode(formatEvent(event.id, event.type, event.sourceTabId)),
      );
    } catch {
      return;
    }
  }
}

export function formatEvent(
  id: number | undefined,
  eventType: SseEventName,
  sourceTabId: string,
): string {
  return `${id === undefined ? "" : `id: ${id}\n`}event: ${eventType}\ndata: ${sourceTabId}\n\n`;
}

function enqueueReset(controller: ReadableStreamDefaultController): void {
  try {
    controller.enqueue(
      encoder.encode(formatEvent(undefined, SSE_EVENTS.reset, "")),
    );
  } catch {}
}

function appendToBuffer(userId: number, event: BufferedEvent): void {
  let buffer = buffers.get(userId);
  if (!buffer) {
    buffer = { events: [], lastTouchAt: Date.now() };
    buffers.set(userId, buffer);
  }
  buffer.events.push(event);
  if (buffer.events.length > BUFFER_MAX_EVENTS) {
    buffer.events.splice(0, buffer.events.length - BUFFER_MAX_EVENTS);
  }
  buffer.lastTouchAt = Date.now();
}

function gcExpiredBuffers(): void {
  const now = Date.now();
  for (const [userId, buffer] of buffers) {
    if (now - buffer.lastTouchAt > BUFFER_TTL_MS) {
      buffers.delete(userId);
    }
  }
}

export function _resetForTest(): void {
  connections.clear();
  buffers.clear();
  state.nextEventId = 1;
}
