import { processInterval, processState } from "../process-state";

const SESSION_IDLE_MS = 24 * 60 * 60 * 1000;

const CLOSE_FAILED_MESSAGE =
  "MCP sessionの終了に失敗しました。sessionは表から外したため処理は続きます。対応不要です（繰り返す場合は続く例外を確認してください）";

const EXPIRE_INTERVAL_MS = 60 * 1000;

export type McpSessionEntries<T> = Map<
  string,
  { transport: T; lastRequestAt: number }
>;

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
        .catch((error) => console.error(CLOSE_FAILED_MESSAGE, error));
      return undefined;
    }
    entry.lastRequestAt = this.now();
    return entry.transport;
  }

  delete(id: string): void {
    this.entries.delete(id);
  }

  async closeAll(): Promise<void> {
    const entries = [...this.entries.values()];
    this.entries.clear();
    for (const entry of entries) {
      try {
        await entry.transport.close();
      } catch (error) {
        console.error(CLOSE_FAILED_MESSAGE, error);
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
        console.error(CLOSE_FAILED_MESSAGE, error);
      }
    }
  }
}

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
