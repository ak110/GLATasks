export type DebugLogCategory = "sse" | "fallback" | "connectivity" | "sync";

export function debugLog(
  category: DebugLogCategory,
  event: string,
  data?: Record<string, unknown>,
): void {
  const label = `[glatasks:${category}] ${event}`;
  if (data === undefined) {
    console.debug(label);
  } else {
    console.debug(label, data);
  }
}
