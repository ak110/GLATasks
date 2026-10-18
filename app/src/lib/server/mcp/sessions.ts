import { processInterval, processState } from "../process-state";

const SESSION_IDLE_MS = 24 * 60 * 60 * 1000;

/** 無活動のtransportを回収する周期（ミリ秒） */
const EXPIRE_INTERVAL_MS = 60 * 1000;

/** session IDごとのtransportと最終要求時刻。 */
export type McpSessionEntries<T> = Map<
  string,
  { transport: T; lastRequestAt: number }
>;

/**
 * 要求ごとに活動時刻を更新し、無活動のtransportを閉じる。
 *
 * 表は呼び出し元が渡す。エンドポイントはモジュールの再評価をまたいで保持した表を渡し、
 * 再評価後の要求も開始済みのsessionへ到達できるようにする（`process-state.ts`を参照）。
 */
export class McpSessions<T extends { close(): Promise<void> }> {
  constructor(
    private readonly entries: McpSessionEntries<T> = new Map(),
    private readonly now: () => number = Date.now,
  ) {}

  set(id: string, transport: T): void {
    this.entries.set(id, { transport, lastRequestAt: this.now() });
  }

  get(id: string): T | undefined {
    const entry = this.entries.get(id);
    if (!entry) return undefined;
    if (this.now() - entry.lastRequestAt >= SESSION_IDLE_MS) {
      this.entries.delete(id);
      void entry.transport
        .close()
        .catch((error) =>
          console.error("MCP sessionの終了に失敗しました", error),
        );
      return undefined;
    }
    entry.lastRequestAt = this.now();
    return entry.transport;
  }

  delete(id: string): void {
    this.entries.delete(id);
  }

  /** 保持中の全transportを閉じて表を空にする（所有者の明示停止）。 */
  async closeAll(): Promise<void> {
    const entries = [...this.entries.values()];
    this.entries.clear();
    for (const entry of entries) {
      try {
        await entry.transport.close();
      } catch (error) {
        console.error("MCP sessionの終了に失敗しました", error);
      }
    }
  }

  async expire(): Promise<void> {
    for (const [id, entry] of this.entries) {
      if (this.now() - entry.lastRequestAt < SESSION_IDLE_MS) continue;
      this.entries.delete(id);
      try {
        await entry.transport.close();
      } catch (error) {
        console.error("MCP sessionの終了に失敗しました", error);
      }
    }
  }
}

/**
 * エンドポイントが使うsession表と回収周期を取得する。
 *
 * 表と周期はモジュールの再評価をまたいで保持し、再評価後のPOST・GET・DELETEと
 * SDKの登録・終了コールバックが同じ表を使う。回収周期は1本のまま、呼び出すたびに
 * 最新の評価の処理へ差し替わる。`stop`は周期を取り消し、保持中の全transportを閉じる。
 */
export function ownMcpSessions<T extends { close(): Promise<void> }>(): {
  sessions: McpSessions<T>;
  stop(): Promise<void>;
} {
  const sessions = new McpSessions<T>(
    processState<McpSessionEntries<T>>("mcp.sessions", () => new Map()),
  );
  const cleanup = processInterval(
    "mcp.sessions.expire",
    EXPIRE_INTERVAL_MS,
    () => void sessions.expire(),
    { unref: true },
  );
  cleanup.start();
  return {
    sessions,
    async stop() {
      cleanup.stop();
      await sessions.closeAll();
    },
  };
}
