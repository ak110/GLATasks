/**
 * @fileoverview MCP公開ツールの一覧と呼び出しの契約テスト
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
    listLists: vi.fn(async () => [{ id: 1, title: "仕事" }]),
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
const {
  getCalorieSummary,
  getUserPreferences,
  listLists,
  updateUserPreferences,
} = await import("../api");
const { sendEvent } = await import("../sse");

type ToolKind = "readOnly" | "additive" | "destructive";

/**
 * ツール名ごとの注釈の区分と入力プロパティ。
 * 区分は参照だけのツールを readOnly、追加だけのツールを additive、既存の状態を上書き・削除するツールを destructive とする。
 */
const TOOL_CONTRACTS: Record<string, readonly [ToolKind, readonly string[]]> = {
  "lists.list": ["readOnly", ["showType"]],
  "lists.create": ["additive", ["title"]],
  "lists.rename": ["destructive", ["listId", "title"]],
  "lists.delete": ["destructive", ["listId"]],
  "lists.archive": ["destructive", ["listId"]],
  "lists.unarchive": ["destructive", ["listId"]],
  "lists.clear": ["destructive", ["listId"]],
  "lists.merge": ["destructive", ["sourceListId", "targetListId"]],
  "tasks.list": ["readOnly", ["ifModifiedSince", "listId", "showType"]],
  "tasks.listActive": ["readOnly", ["since"]],
  "tasks.create": ["additive", ["kind", "listId", "tags", "text"]],
  "tasks.update": [
    "destructive",
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
  "tasks.search": ["readOnly", ["query", "showType"]],
  "tasks.reorder": ["destructive", ["listId", "taskIds"]],
  "timers.list": ["readOnly", []],
  "timers.create": [
    "additive",
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
    "destructive",
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
  "timers.delete": ["destructive", ["timerId"]],
  "timers.start": ["destructive", ["timerId", "tzOffsetMinutes"]],
  "timers.pause": ["destructive", ["timerId"]],
  "timers.reset": ["destructive", ["timerId", "tzOffsetMinutes"]],
  "timers.adjust": ["destructive", ["minutes", "timerId"]],
  "timers.setTime": [
    "destructive",
    ["seconds", "targetMinutes", "timerId", "tzOffsetMinutes"],
  ],
  "timers.stop": ["destructive", ["startedAt", "timerId"]],
  "timers.reorder": ["destructive", ["timerIds"]],
  "calories.summary": ["readOnly", ["tzOffsetMinutes"]],
  "calories.listRecords": ["readOnly", ["tzOffsetMinutes", "windowOffset"]],
  "calories.listItems": ["readOnly", []],
  "users.getPreferences": ["readOnly", []],
  "users.updatePreferences": [
    "destructive",
    ["adjustMinutes", "baseSeconds", "calorieGoalKcal", "mode", "ringSeconds"],
  ],
};

const EXPECTED_ANNOTATIONS: Record<ToolKind, Record<string, boolean>> = {
  readOnly: { readOnlyHint: true },
  additive: { readOnlyHint: false, destructiveHint: false },
  destructive: { readOnlyHint: false, destructiveHint: true },
};

/** 用途が近く取り違えやすいため、説明で互いを名指しして使い分けを示すツールの組。 */
const SIBLING_GROUPS = [
  ["tasks.list", "tasks.listActive", "tasks.search"],
  ["lists.archive", "lists.clear", "lists.delete", "lists.merge"],
  [
    "timers.pause",
    "timers.stop",
    "timers.reset",
    "timers.setTime",
    "timers.adjust",
  ],
  ["calories.summary", "calories.listRecords", "calories.listItems"],
] as const;

/** Claude Codeが初期送信でツール説明とinstructionsを切り詰める文字数。 */
const MAX_DESCRIPTION_LENGTH = 4096;

const AUTH_INFO: AuthInfo = {
  token: "test-token",
  clientId: "test-client",
  scopes: [],
  extra: { userId: 42 },
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

describe("MCPツール", () => {
  beforeEach(() => {
    preferences = {};
    vi.clearAllMocks();
  });

  it("全ツールが説明・タイトル・注釈・引数説明を公開する", async () => {
    const { client, server } = await createClient();
    try {
      const { tools } = await client.listTools();
      const toolNames = new Set(tools.map((tool) => tool.name));
      expect([...toolNames].sort()).toEqual(Object.keys(TOOL_CONTRACTS).sort());

      const instructions = client.getInstructions() ?? "";
      expect(instructions).not.toBe("");
      expect(instructions.length).toBeLessThanOrEqual(MAX_DESCRIPTION_LENGTH);

      const namespaces = [
        ...new Set([...toolNames].map((name) => name.split(".")[0])),
      ];
      const toolReference = new RegExp(
        `\\b(?:${namespaces.join("|")})\\.[A-Za-z]+\\b`,
        "g",
      );
      for (const tool of tools) {
        const [kind, properties] = TOOL_CONTRACTS[tool.name];
        const description = tool.description ?? "";
        expect(description, tool.name).not.toBe("");
        expect(description.length, tool.name).toBeLessThanOrEqual(
          MAX_DESCRIPTION_LENGTH,
        );
        expect(tool.title, tool.name).toMatch(/\S/);
        expect(tool.annotations, tool.name).toEqual(EXPECTED_ANNOTATIONS[kind]);
        for (const reference of [
          ...description.matchAll(toolReference),
          ...instructions.matchAll(toolReference),
        ]) {
          expect(toolNames, `${tool.name}: ${reference[0]}`).toContain(
            reference[0],
          );
        }

        const inputProperties = (tool.inputSchema.properties ?? {}) as Record<
          string,
          { description?: string }
        >;
        expect(Object.keys(inputProperties).sort(), tool.name).toEqual(
          [...properties].sort(),
        );
        for (const [property, schema] of Object.entries(inputProperties)) {
          expect(schema.description, `${tool.name}.${property}`).toMatch(/\S/);
        }
      }

      const descriptions = new Map(
        tools.map((tool) => [tool.name, tool.description ?? ""]),
      );
      for (const group of SIBLING_GROUPS) {
        for (const name of group) {
          for (const sibling of group.filter((other) => other !== name)) {
            expect(descriptions.get(name), name).toContain(sibling);
          }
        }
      }
    } finally {
      await client.close();
      await server.close();
    }
  });

  it("リスト一覧は指定した表示範囲で取得する", async () => {
    const { client, server } = await createClient(AUTH_INFO);
    try {
      const result = await client.callTool({
        name: "lists.list",
        arguments: { showType: "archived" },
      });
      expect(result.isError).toBeFalsy();
      expect(listLists).toHaveBeenCalledWith(42, "archived");
      expect(result.content).toEqual([
        {
          type: "text",
          text: JSON.stringify([{ id: 1, title: "仕事" }], null, 2),
        },
      ]);
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
          text: JSON.stringify(
            {
              error:
                "対象が見つかりません。一覧を取得し直し（画面では再読み込みし）、存在する対象を指定してください。",
            },
            null,
            2,
          ),
        },
      ]);
      expect(sendEvent).not.toHaveBeenCalled();
    } finally {
      await client.close();
      await server.close();
    }
  });
});
