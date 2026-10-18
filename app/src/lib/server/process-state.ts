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

/**
 * `globalThis`上のキーの接頭辞。`Symbol.for`で世代間に同じキーを得る。
 * `db.ts`のプール（`glatasks.server.db.pool`）と区別し、テスト用の破棄の対象を本モジュールの状態に限る。
 */
const KEY_PREFIX = "glatasks.server.state.";

type Holder = Record<symbol, unknown>;

function holder(): Holder {
  return globalThis as unknown as Holder;
}

/**
 * 名前ごとに世代を越えて保持する状態を返す。未作成なら`create`で作成する。
 *
 * 同じ名前に異なる型の状態を割り当てないこと（名前は保持先の識別子である）。
 */
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

/** 周期処理の操作。開始・停止は世代を越えて同じタイマーを対象にする。 */
export interface ProcessInterval {
  /** タイマーが無ければ開始する。開始済みなら何もしない。 */
  start(): void;
  /** タイマーを取り消す。 */
  stop(): void;
  /** タイマーが動作中かを返す。 */
  readonly running: boolean;
}

/**
 * 名前ごとに1本の周期タイマーを保持し、呼び出す処理を`handler`へ差し替える。
 *
 * モジュールのトップレベルで呼ぶと、再評価のたびに処理参照だけが更新される。
 * `unref`を真にするとタイマーがプロセスの生存を妨げない。
 */
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

/**
 * テスト用: 保持した状態とタイマーを全て破棄する。
 *
 * 周期タイマーは取り消してから破棄する。業務上の後始末（transportのcloseなど）は
 * 各モジュールの停止処理が担う。
 */
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
