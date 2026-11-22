/**
 * @fileoverview モジュールの再評価をまたいでサーバー状態と周期処理を保持する共通の所有機構
 *
 * 開発サーバーはコード更新のたびに同じNode.jsプロセスでサーバーモジュールを再評価する。
 * MCPセッション・SSE接続・OAuth認可コード・schedulerの状態をモジュール変数に置くと、
 * 再評価前に開始した要求・接続が旧世代の表に残り、新世代の処理から到達できなくなる。
 *
 * 本モジュールは、世代を越えて保持する状態（表・カウンター・フラグ）と周期タイマーだけを
 * `globalThis`上へ置き、業務処理は各モジュールの最新の評価に置く。
 * 周期処理は名前ごとに1本のタイマーを保持し、モジュールが評価されるたびに呼び出す処理を
 * 最新の関数へ差し替えるため、再評価でタイマーが増えず、次の周期は更新後の処理を呼ぶ。
 * 本番では各モジュールが1回だけ評価されるため、保持の有無で挙動は変わらない。
 * DB接続プールは`db.ts`が同じ方針で保持する。
 */

const KEY_PREFIX = "glatasks.server.state.";

type Holder = Record<symbol, unknown>;

function holder(): Holder {
  return globalThis as unknown as Holder;
}

export function processState<T>(name: string, create: () => T): T {
  const key = Symbol.for(KEY_PREFIX + name);
  const store = holder();
  if (!(key in store)) store[key] = create();
  return store[key] as T;
}

interface IntervalEntry {
  handler: () => void;
  timer: ReturnType<typeof setInterval> | undefined;
}

export interface ProcessInterval {
  start(): void;
  stop(): void;
  readonly running: boolean;
}

export function processInterval(
  name: string,
  intervalMs: number,
  handler: () => void,
  options: { unref?: boolean } = {},
): ProcessInterval {
  const entry = processState<IntervalEntry>(`interval.${name}`, () => ({
    handler,
    timer: undefined,
  }));
  entry.handler = handler;
  return {
    start() {
      if (entry.timer !== undefined) return;
      entry.timer = setInterval(() => entry.handler(), intervalMs);
      if (options.unref) entry.timer.unref();
    },
    stop() {
      if (entry.timer === undefined) return;
      clearInterval(entry.timer);
      entry.timer = undefined;
    },
    get running() {
      return entry.timer !== undefined;
    },
  };
}

export function _resetProcessStateForTest(): void {
  const store = holder();
  for (const key of Object.getOwnPropertySymbols(store)) {
    const description = key.description;
    if (!description?.startsWith(KEY_PREFIX)) continue;
    if (description.startsWith(`${KEY_PREFIX}interval.`)) {
      const entry = store[key] as IntervalEntry;
      if (entry.timer !== undefined) clearInterval(entry.timer);
    }
    delete store[key];
  }
}
