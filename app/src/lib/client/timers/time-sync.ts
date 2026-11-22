let serverOffset = 0;
const offsetListeners = new Set<(offset: number) => void>();

export function getServerOffset(): number {
  return serverOffset;
}

export function setServerOffset(value: number): void {
  serverOffset = value;
  for (const cb of offsetListeners) {
    cb(value);
  }
}

export function onOffsetChange(cb: (offset: number) => void): () => void {
  offsetListeners.add(cb);
  return () => offsetListeners.delete(cb);
}
