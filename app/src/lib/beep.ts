/**
 * @fileoverview Web Audio API ビープ音ユーティリティ（タイマー通知用）
 *
 * AudioContext が利用できない環境では警告ログを出力して何もしない。
 */

/**
 * ビープ音を指定回数再生する。
 * AudioContext が利用できない環境では警告ログを出力する。
 */
async function beep(
  count: number,
  freq: number,
  duration: number,
  interval: number,
): Promise<void> {
  if (typeof AudioContext === "undefined") {
    console.warn("AudioContext が利用できないためビープ音を再生できません");
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

/** タイマー完了時のビープ（低め・長め「ぽーっ、ぽーっ」） */
export async function playBeep(count = 5, interval = 200): Promise<void> {
  await beep(count, 440, 400, interval);
}

/** タイマー開始時の確認ビープ（高め・短い「ぴぴっ」） */
export async function playStartBeep(): Promise<void> {
  await beep(2, 880, 80, 60);
}

// ── ループビープ（タイマー完了アラーム用） ──

/**
 * タイマーIDごとのループビープハンドル。
 * stop が呼ばれるかタイマー画面/SSE経由で停止検知されるまで鳴り続ける。
 */
type LoopHandle = {
  ctx: AudioContext;
  stopped: boolean;
};

const loopHandles = new Map<number, LoopHandle>();

/**
 * 指定タイマーIDに対しビープをループ再生する。
 * 既にループ中の場合は何もしない（多重起動防止）。
 * AudioContext が無い環境では警告を出して終了する。
 */
export function startLoopBeep(timerId: number): void {
  if (loopHandles.has(timerId)) return;
  if (typeof AudioContext === "undefined") {
    console.warn("AudioContext が利用できないためビープ音を再生できません");
    return;
  }
  const ctx = new AudioContext();
  const handle: LoopHandle = { ctx, stopped: false };
  loopHandles.set(timerId, handle);
  // バックグラウンドで非同期にループ
  void runLoop(timerId, handle);
}

/** 指定タイマーIDのループビープを停止する */
export function stopLoopBeep(timerId: number): void {
  const handle = loopHandles.get(timerId);
  if (!handle) return;
  handle.stopped = true;
  loopHandles.delete(timerId);
  // close は失敗しても無視（既に閉じている場合がある）
  handle.ctx.close().catch(() => {});
}

/** すべてのループビープを停止する（テスト/デバッグ用途） */
export function stopAllLoopBeeps(): void {
  for (const id of [...loopHandles.keys()]) {
    stopLoopBeep(id);
  }
}

async function runLoop(timerId: number, handle: LoopHandle): Promise<void> {
  // タイマー完了を強調する周期: ぽーっ x5 → 1.5秒 休止 → 繰り返し
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
  // 念のため呼び出し（stopLoopBeep 経由でない終了パスを保護）
  if (loopHandles.get(timerId) === handle) {
    loopHandles.delete(timerId);
    handle.ctx.close().catch(() => {});
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
