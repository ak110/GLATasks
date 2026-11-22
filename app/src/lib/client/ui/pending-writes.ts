let pendingCount = 0;

export async function trackPendingWrite<T>(run: () => Promise<T>): Promise<T> {
  pendingCount += 1;
  try {
    return await run();
  } finally {
    pendingCount -= 1;
  }
}

export function hasPendingDirectWrites(): boolean {
  return pendingCount > 0;
}
