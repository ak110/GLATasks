import { onMount } from "svelte";
import {
  subscribe,
  onHealthChange,
  getHealth,
  type HealthState,
} from "#lib/client/sse/sse-client.ts";
import { checkConnectivity } from "#lib/client/sse/connection-recovery.svelte.ts";
import { debugLog } from "#lib/client/debug-log.ts";
import type { SseEventName } from "#lib/sse-events.ts";

type SseHandler = (event: MessageEvent) => void;
type FallbackFn = () => void | Promise<void>;

export type SseSubscription = {
  handler: SseHandler;
  fallback?: FallbackFn;
};

const FALLBACK_POLL_INTERVAL_MS = 30_000;

export function setupSseSubscriptions(
  subscriptions: Partial<Record<SseEventName, SseSubscription>>,
): () => void {
  const fallbacks: FallbackFn[] = [];
  const unsubs: Array<() => void> = [];
  for (const [eventName, sub] of Object.entries(subscriptions)) {
    const { handler, fallback } = sub as SseSubscription;
    if (fallback) fallbacks.push(fallback);
    unsubs.push(subscribe(eventName as SseEventName, handler));
  }

  let pollTimer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  const runFallbacks = async (): Promise<void> => {
    if (running) return;
    debugLog("fallback", "run", { count: fallbacks.length });
    running = true;
    try {
      for (const fn of fallbacks) {
        try {
          await fn();
        } catch {}
      }
    } finally {
      running = false;
    }
  };

  const startPolling = (): void => {
    if (pollTimer) return;
    debugLog("fallback", "polling-start", {
      intervalMs: FALLBACK_POLL_INTERVAL_MS,
    });
    pollTimer = setInterval(() => {
      void runFallbacks();
    }, FALLBACK_POLL_INTERVAL_MS);
  };

  const stopPolling = (): void => {
    if (pollTimer) {
      debugLog("fallback", "polling-stop");
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  const handleHealth = (state: HealthState): void => {
    debugLog("fallback", "health", { state });
    if (state === "unhealthy") {
      void checkConnectivity();
      void runFallbacks();
      startPolling();
    } else if (state === "healthy") {
      stopPolling();
    }
  };

  const unsubHealth = onHealthChange(handleHealth);
  handleHealth(getHealth());

  return () => {
    unsubHealth();
    stopPolling();
    for (const unsub of unsubs) {
      unsub();
    }
  };
}

export function subscribeOnMount(
  subscriptions: Partial<Record<SseEventName, SseSubscription>>,
): void {
  onMount(() => setupSseSubscriptions(subscriptions));
}
