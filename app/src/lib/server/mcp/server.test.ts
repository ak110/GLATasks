/**
 * @fileoverview MCP公開ツールの利用者設定契約テスト
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SSE_EVENTS } from "$lib/sse-events";

let preferences: Record<string, unknown> = {};

vi.mock("../api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../api")>();
  return {
    ...actual,
    getUserPreferences: vi.fn(async () => preferences),
    updateUserPreferences: vi.fn(
      async (_userId: number, input: Record<string, unknown>) => {
        preferences = { ...preferences, ...input };
      },
    ),
  };
});

vi.mock("../sse", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../sse")>();
  return { ...actual, sendEvent: vi.fn() };
});

const { createMcpServer } = await import("./server");
const { getUserPreferences, updateUserPreferences } = await import("../api");
const { sendEvent } = await import("../sse");

const TOOL_CONTRACTS: Record<string, readonly [string, readonly string[]]> = {
  "lists.list": ["リスト一覧を取得する", []],
  "lists.create": ["新規リストを作成する", ["title"]],
  "lists.rename": ["リスト名を変更する", ["listId", "title"]],
  "lists.delete": ["リストとその全タスクを削除する", ["listId"]],
  "lists.archive": ["リストをアーカイブする", ["listId"]],
  "lists.unarchive": ["アーカイブ済みリストを active に戻す", ["listId"]],
  "lists.clear": ["リスト内の完了済みタスクをアーカイブする", ["listId"]],
  "lists.merge": [
    "リスト同士を統合する（source の全タスクを target に移動）",
    ["sourceListId", "targetListId"],
  ],
  "tasks.list": [
    "指定リスト内のタスクを取得する",
    ["ifModifiedSince", "listId", "showType"],
  ],
  "tasks.listActive": [
    "ユーザーの全アクティブタスクを取得する（差分sync対応）",
    ["since"],
  ],
  "tasks.create": ["新規タスクを追加する", ["kind", "listId", "tags", "text"]],
  "tasks.update": [
    "既存タスクを更新する（テキスト・ステータス・タグ・移動）",
    [
      "completed",
      "keep_order",
      "kind",
      "listId",
      "move_to",
      "status",
      "tags",
      "taskId",
      "text",
    ],
  ],
  "tasks.search": [
    "全タスクを全文検索する（query は1～255文字、showType の既定値は active）",
    ["query", "showType"],
  ],
  "tasks.reorder": ["リスト内のタスク並び順を更新する", ["listId", "taskIds"]],
  "timers.list": ["タイマー一覧を取得する", []],
  "timers.create": [
    "タイマーを新規作成する",
    [
      "adjust_minutes",
      "base_seconds",
      "ephemeral",
      "mode",
      "name",
      "ring_seconds",
      "target_minutes",
      "tz_offset_minutes",
    ],
  ],
  "timers.update": [
    "タイマー設定を更新する",
    [
      "adjust_minutes",
      "base_seconds",
      "mode",
      "name",
      "ring_seconds",
      "target_minutes",
      "timerId",
      "tz_offset_minutes",
    ],
  ],
  "timers.delete": ["タイマーを削除する", ["timerId"]],
  "timers.start": [
    "タイマーを開始する（アラーム時はクライアントのTZオフセットを渡す）",
    ["timerId", "tz_offset_minutes"],
  ],
  "timers.pause": ["実行中タイマーを一時停止する", ["timerId"]],
  "timers.reset": [
    "タイマーを初期状態にリセットする",
    ["timerId", "tz_offset_minutes"],
  ],
  "timers.adjust": [
    "タイマーの残り時間を加算・減算する（minutes は正負の整数）",
    ["minutes", "timerId"],
  ],
  "timers.setTime": [
    "タイマーのベース時間・目標時刻を上書きする",
    ["seconds", "target_minutes", "timerId", "tz_offset_minutes"],
  ],
  "timers.stop": [
    "鳴っているタイマーを止める（started_at の不変条件を確認）",
    ["started_at", "timerId"],
  ],
  "timers.reorder": ["タイマー並び順を更新する", ["timerIds"]],
  "users.getPreferences": [
    "利用者の新規タイマーデフォルト値とカロリー目標値を取得する",
    [],
  ],
  "users.updatePreferences": [
    "利用者の新規タイマーデフォルト値とカロリー目標値のうち、指定した項目だけを更新する",
    [
      "adjust_minutes",
      "base_seconds",
      "calorie_goal_kcal",
      "mode",
      "ring_seconds",
    ],
  ],
};

async function createClient(authInfo?: AuthInfo) {
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  if (authInfo) {
    const send = clientTransport.send.bind(clientTransport);
    clientTransport.send = (message, options) =>
      send(message, { ...options, authInfo });
  }
  const server = createMcpServer();
  const client = new Client({ name: "test-client", version: "1.0.0" });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return { client, server };
}

describe("利用者設定MCPツール", () => {
  beforeEach(() => {
    preferences = {};
    vi.clearAllMocks();
  });

  it("全ツールの名前・説明・入力プロパティを公開する", async () => {
    const { client, server } = await createClient();
    try {
      const { tools } = await client.listTools();
      expect(tools.map((tool) => tool.name).sort()).toEqual(
        Object.keys(TOOL_CONTRACTS).sort(),
      );
      for (const tool of tools) {
        const [description, properties] = TOOL_CONTRACTS[tool.name];
        expect(tool.description, tool.name).toBe(description);
        expect(
          Object.keys(tool.inputSchema.properties ?? {}).sort(),
          tool.name,
        ).toEqual([...properties].sort());
      }
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("認証済み呼び出しは部分更新してSSEを送出する", async () => {
    const authInfo: AuthInfo = {
      token: "test-token",
      clientId: "test-client",
      scopes: [],
      extra: { userId: 42 },
    };
    const { client, server } = await createClient(authInfo);
    try {
      await client.callTool({
        name: "users.updatePreferences",
        arguments: { ring_seconds: 10 },
      });
      await client.callTool({
        name: "users.updatePreferences",
        arguments: { calorie_goal_kcal: 1800 },
      });
      expect(updateUserPreferences).toHaveBeenNthCalledWith(1, 42, {
        ring_seconds: 10,
      });
      expect(updateUserPreferences).toHaveBeenNthCalledWith(2, 42, {
        calorie_goal_kcal: 1800,
      });
      expect(await getUserPreferences(42)).toEqual({
        ring_seconds: 10,
        calorie_goal_kcal: 1800,
      });
      expect(sendEvent).toHaveBeenCalledWith(
        42,
        SSE_EVENTS.usersPreferencesUpdated,
        null,
      );
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("認証なしではハンドラーへ到達せずエラー結果を返す", async () => {
    const { client, server } = await createClient();
    try {
      const result = await client.callTool({
        name: "users.updatePreferences",
        arguments: { calorie_goal_kcal: 1800 },
      });
      expect(result.isError).toBe(true);
      expect(updateUserPreferences).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await server.close();
    }
  });
});
