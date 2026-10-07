/**
 * @fileoverview MCP公開ツールの利用者設定契約テスト
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { SSE_EVENTS } from "#lib/sse-events.ts";
import { ApiError } from "../api-errors";

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
    getCalorieSummary: vi.fn(async () => ({ goalKcal: 1615 })),
    mergeLists: vi.fn(async () => {}),
    createTask: vi.fn(async () => {
      throw new ApiError("not_found_or_forbidden");
    }),
  };
});

vi.mock("../sse", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../sse")>();
  return { ...actual, sendEvent: vi.fn() };
});

const { createMcpServer } = await import("./server");
const { getCalorieSummary, getUserPreferences, updateUserPreferences } =
  await import("../api");
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
      "keepOrder",
      "kind",
      "listId",
      "moveTo",
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
      "adjustMinutes",
      "baseSeconds",
      "ephemeral",
      "mode",
      "name",
      "ringSeconds",
      "targetMinutes",
      "tzOffsetMinutes",
    ],
  ],
  "timers.update": [
    "タイマー設定を更新する",
    [
      "adjustMinutes",
      "baseSeconds",
      "mode",
      "name",
      "ringSeconds",
      "targetMinutes",
      "timerId",
      "tzOffsetMinutes",
    ],
  ],
  "timers.delete": ["タイマーを削除する", ["timerId"]],
  "timers.start": [
    "タイマーを開始する（アラーム時はクライアントのTZオフセットを渡す）",
    ["timerId", "tzOffsetMinutes"],
  ],
  "timers.pause": ["実行中タイマーを一時停止する", ["timerId"]],
  "timers.reset": [
    "タイマーを初期状態にリセットする",
    ["timerId", "tzOffsetMinutes"],
  ],
  "timers.adjust": [
    "タイマーの残り時間を加算・減算する（minutes は正負の整数）",
    ["minutes", "timerId"],
  ],
  "timers.setTime": [
    "タイマーのベース時間・目標時刻を上書きする",
    ["seconds", "targetMinutes", "timerId", "tzOffsetMinutes"],
  ],
  "timers.stop": [
    "鳴っているタイマーを止める（startedAt の不変条件を確認）",
    ["startedAt", "timerId"],
  ],
  "timers.reorder": ["タイマー並び順を更新する", ["timerIds"]],
  "calories.summary": [
    "カロリーの集計（1日当たりペース・7日間平均・28日間平均・達成状況）を取得する（tzOffsetMinutes はUTCからの時差の分数で、日本時間は540）",
    ["tzOffsetMinutes"],
  ],
  "calories.listRecords": [
    "カロリーの摂取記録を30日単位で新しい順に取得する（windowOffset は0で今日までの30日、1でその前の30日。tzOffsetMinutes はUTCからの時差の分数で、日本時間は540。品目表へ登録しない一時項目の記録は temporary が true で、quantity がkcal）",
    ["tzOffsetMinutes", "windowOffset"],
  ],
  "calories.listItems": [
    "カロリーの品目（名前・1個当たりのkcal・備考）を取得する",
    [],
  ],
  "users.getPreferences": [
    "利用者の新規タイマーデフォルト値とカロリー目標値を取得する",
    [],
  ],
  "users.updatePreferences": [
    "利用者の新規タイマーデフォルト値とカロリー目標値のうち、指定した項目だけを更新する",
    ["adjustMinutes", "baseSeconds", "calorieGoalKcal", "mode", "ringSeconds"],
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
        arguments: { ringSeconds: 10 },
      });
      await client.callTool({
        name: "users.updatePreferences",
        arguments: { calorieGoalKcal: 1800 },
      });
      expect(updateUserPreferences).toHaveBeenNthCalledWith(1, 42, {
        ringSeconds: 10,
      });
      expect(updateUserPreferences).toHaveBeenNthCalledWith(2, 42, {
        calorieGoalKcal: 1800,
      });
      expect(await getUserPreferences(42)).toEqual({
        ringSeconds: 10,
        calorieGoalKcal: 1800,
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

  it("カロリーの集計は認証済み利用者と指定した時差で取得する", async () => {
    const authInfo: AuthInfo = {
      token: "test-token",
      clientId: "test-client",
      scopes: [],
      extra: { userId: 42 },
    };
    const { client, server } = await createClient(authInfo);
    try {
      const result = await client.callTool({
        name: "calories.summary",
        arguments: { tzOffsetMinutes: 540 },
      });
      expect(getCalorieSummary).toHaveBeenCalledWith(42, 540);
      expect(result.content).toEqual([
        { type: "text", text: JSON.stringify({ goalKcal: 1615 }, null, 2) },
      ]);
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
        arguments: { calorieGoalKcal: 1800 },
      });
      expect(result.isError).toBe(true);
      expect(updateUserPreferences).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("リスト統合はタスクと定期TODOを含む3資源を通知する", async () => {
    const { client, server } = await createClient({
      token: "test-token",
      clientId: "test-client",
      scopes: [],
      extra: { userId: 42 },
    });
    try {
      await client.callTool({
        name: "lists.merge",
        arguments: { sourceListId: 1, targetListId: 2 },
      });
      expect(vi.mocked(sendEvent).mock.calls).toEqual([
        [42, SSE_EVENTS.listsUpdated, null],
        [42, SSE_EVENTS.tasksUpdated, null],
        [42, SSE_EVENTS.schedulesUpdated, null],
      ]);
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("存在しないリストへの追加は内部識別子を公開せず表示文言を返す", async () => {
    const { client, server } = await createClient({
      token: "test-token",
      clientId: "test-client",
      scopes: [],
      extra: { userId: 42 },
    });
    try {
      const result = await client.callTool({
        name: "tasks.create",
        arguments: { listId: 999, text: "追加" },
      });
      expect(result.isError).toBe(true);
      expect(result.content).toEqual([
        {
          type: "text",
          text: JSON.stringify({ error: "対象が見つかりません" }, null, 2),
        },
      ]);
      expect(sendEvent).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await server.close();
    }
  });
});
