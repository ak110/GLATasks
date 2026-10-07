const SESSION_IDLE_MS = 24 * 60 * 60 * 1000;

/** 要求ごとに活動時刻を更新し、無活動のtransportを閉じる。 */
export class McpSessions<T extends { close(): Promise<void> }> {
  private readonly entries = new Map<
    string,
    { transport: T; lastRequestAt: number }
  >();
  constructor(private readonly now: () => number = Date.now) {}

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
