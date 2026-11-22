async function beep(
  count: number,
  freq: number,
  duration: number,
  interval: number,
): Promise<void> {
  if (typeof AudioContext === "undefined") {
    console.warn(
      "AudioContext が利用できないためビープ音を再生できません。タイマーの画面表示と通知は続きます。音を鳴らすにはAudioContextに対応したブラウザーで開いてください",
    );
    return;
  }
  const ctx = new AudioContext();
  try {
    for (let i = 0; i < count; i++) {
      if (i > 0) await sleep(interval);
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.value = 0.3;
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + duration / 1000);
      await sleep(duration);
    }
  } finally {
    await ctx.close();
  }
}

export async function playStartBeep(): Promise<void> {
  await beep(2, 880, 80, 60);
}

type LoopHandle = {
  ctx: AudioContext;
  stopped: boolean;
  autoStopTimeoutId: ReturnType<typeof setTimeout>;
};

const loopHandles = new Map<number, LoopHandle>();

export function startLoopBeep(timerId: number, ringSeconds: number): void {
  if (loopHandles.has(timerId)) return;
  if (typeof AudioContext === "undefined") {
    console.warn(
      "AudioContext が利用できないためビープ音を再生できません。タイマーの画面表示と通知は続きます。音を鳴らすにはAudioContextに対応したブラウザーで開いてください",
    );
    return;
  }
  const ctx = new AudioContext();
  const autoStopTimeoutId = setTimeout(
    () => stopLoopBeep(timerId),
    ringSeconds * 1000,
  );
  const handle: LoopHandle = { ctx, stopped: false, autoStopTimeoutId };
  loopHandles.set(timerId, handle);
  void runLoop(timerId, handle);
}

export function stopLoopBeep(timerId: number): void {
  const handle = loopHandles.get(timerId);
  if (!handle) return;
  handle.stopped = true;
  clearTimeout(handle.autoStopTimeoutId);
  loopHandles.delete(timerId);
  handle.ctx.close().catch(() => {});
}

export function stopAllLoopBeeps(): void {
  for (const id of loopHandles.keys()) {
    stopLoopBeep(id);
  }
}

async function runLoop(timerId: number, handle: LoopHandle): Promise<void> {
  const count = 5;
  const freq = 440;
  const duration = 400;
  const interval = 200;
  const cycleGap = 1500;
  while (!handle.stopped) {
    for (let i = 0; i < count; i++) {
      if (handle.stopped) return;
      if (i > 0) await sleep(interval);
      const osc = handle.ctx.createOscillator();
      const gain = handle.ctx.createGain();
      osc.frequency.value = freq;
      gain.gain.value = 0.3;
      osc.connect(gain);
      gain.connect(handle.ctx.destination);
      osc.start(handle.ctx.currentTime);
      osc.stop(handle.ctx.currentTime + duration / 1000);
      await sleep(duration);
    }
    if (handle.stopped) return;
    await sleep(cycleGap);
  }
  if (loopHandles.get(timerId) === handle) {
    loopHandles.delete(timerId);
    handle.ctx.close().catch(() => {});
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
