export function startMinuteTicker(callback: () => void): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const schedule = () => {
    const now = Date.now();
    const nextMinute = Math.floor(now / 60_000) * 60_000 + 60_000;
    timer = setTimeout(() => {
      callback();
      schedule();
    }, nextMinute - now);
  };
  schedule();
  return () => clearTimeout(timer);
}
