export const UPDATE_RELOAD_RETRY_INTERVAL_MS = 3_000;

export interface UpdateReloadOptions {
  isBusy: () => boolean;
  hasPendingWrites: () => boolean;
  isServerHealthy: () => Promise<boolean>;
  reload: () => void;
  retryIntervalMs?: number;
}

export function startUpdateAutoReload({
  isBusy,
  hasPendingWrites,
  isServerHealthy,
  reload,
  retryIntervalMs = UPDATE_RELOAD_RETRY_INTERVAL_MS,
}: UpdateReloadOptions): () => void {
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const attempt = async (): Promise<void> => {
    timer = undefined;
    if (stopped) return;
    if (!isBusy() && !hasPendingWrites() && (await isServerHealthy())) {
      if (!stopped && !isBusy() && !hasPendingWrites()) {
        stopped = true;
        reload();
        return;
      }
    }
    if (!stopped) timer = setTimeout(() => void attempt(), retryIntervalMs);
  };

  void attempt();
  return () => {
    stopped = true;
    if (timer !== undefined) clearTimeout(timer);
  };
}
