/**
 * @fileoverview MCP サーバー定義
 *
 * 操作層の関数を MCP ツールとして公開する。
 * リスト・タスク・タイマー・利用者設定はtRPCルーター（`trpc.ts`）と同じ操作を網羅し、
 * カロリーは参照だけを公開する。
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { z } from "zod";
import * as operations from "../operations";
import { getPublicError } from "../api-errors";
import {
  CreateListSchema,
  CreateTaskSchema,
  CreateTimerSchema,
  GetActiveTasksSchema,
  GetListTasksSchema,
  MergeListSchema,
  ShowTypeSchema,
  UpdateListSchema,
  UpdateTaskSchema,
  UpdateTimerSchema,
  TimerIdSchema,
  TimerStopSchema,
  AdjustTimerSchema,
  SetTimerTimeSchema,
  StartTimerSchema,
  ResetTimerSchema,
  SearchTasksSchema,
  ReorderTasksSchema,
  ReorderTimersSchema,
  UserPreferencesSchema,
  GetCalorieSummarySchema,
  ListCalorieRecordsSchema,
} from "#lib/schemas.ts";

/** AuthInfo.extra からアプリ内ユーザーIDを取り出す */
function getUserId(authInfo: AuthInfo | undefined): number {
  const userId = authInfo?.extra?.userId;
  if (typeof userId !== "number") {
    throw new Error("認証情報からユーザーIDが取得できません");
  }
  return userId;
}

/** ツール戻り値（JSON 形式の単一 text コンテンツ） */
function jsonResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2),
      },
    ],
  };
}

/** すべてのツールで同じ公開エラーへ変換する。 */
async function toolResult(operation: () => Promise<unknown>) {
  try {
    return jsonResult(await operation());
  } catch (error) {
    return {
      ...jsonResult({ error: getPublicError(error).message }),
      isError: true,
    };
  }
}

export function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: "glatasks", version: "1.0.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "GLATasks のタスク・リスト・タイマー操作とカロリー記録の参照を提供する。" +
        "タスクは複数のリストに属し、タイマーは独立して動作する。",
    },
  );

  // ── リスト ──
  server.registerTool(
    "lists.list",
    { description: "リスト一覧を取得する", inputSchema: ShowTypeSchema },
    async (input, { authInfo }) => {
      return toolResult(() =>
        operations.lists.list(
          { userId: getUserId(authInfo), tabId: null },
          input,
        ),
      );
    },
  );

  server.registerTool(
    "lists.create",
    { description: "新規リストを作成する", inputSchema: CreateListSchema },
    async (input, { authInfo }) => {
      return toolResult(() =>
        operations.lists.create(
          { userId: getUserId(authInfo), tabId: null },
          input,
        ),
      );
    },
  );

  server.registerTool(
    "lists.rename",
    { description: "リスト名を変更する", inputSchema: UpdateListSchema },
    async (input, { authInfo }) => {
      return toolResult(() =>
        operations.lists.rename(
          { userId: getUserId(authInfo), tabId: null },
          input,
        ),
      );
    },
  );

  server.registerTool(
    "lists.delete",
    {
      description: "リストとその全タスクを削除する",
      inputSchema: UpdateListSchema.pick({ listId: true }),
    },
    async (input, { authInfo }) => {
      return toolResult(() =>
        operations.lists.delete(
          { userId: getUserId(authInfo), tabId: null },
          input,
        ),
      );
    },
  );

  server.registerTool(
    "lists.archive",
    {
      description: "リストをアーカイブする",
      inputSchema: UpdateListSchema.pick({ listId: true }),
    },
    async (input, { authInfo }) => {
      return toolResult(() =>
        operations.lists.archive(
          { userId: getUserId(authInfo), tabId: null },
          input,
        ),
      );
    },
  );

  server.registerTool(
    "lists.unarchive",
    {
      description: "アーカイブ済みリストを active に戻す",
      inputSchema: UpdateListSchema.pick({ listId: true }),
    },
    async (input, { authInfo }) => {
      return toolResult(() =>
        operations.lists.unarchive(
          { userId: getUserId(authInfo), tabId: null },
          input,
        ),
      );
    },
  );

  server.registerTool(
    "lists.clear",
    {
      description: "リスト内の完了済みタスクをアーカイブする",
      inputSchema: UpdateListSchema.pick({ listId: true }),
    },
    async (input, { authInfo }) => {
      return toolResult(() =>
        operations.lists.clear(
          { userId: getUserId(authInfo), tabId: null },
          input,
        ),
      );
    },
  );

  server.registerTool(
    "lists.merge",
    {
      description: "リスト同士を統合する（source の全タスクを target に移動）",
      inputSchema: MergeListSchema,
    },
    async (input, { authInfo }) => {
      return toolResult(() =>
        operations.lists.merge(
          { userId: getUserId(authInfo), tabId: null },
          input,
        ),
      );
    },
  );

  // ── タスク ──
  server.registerTool(
    "tasks.list",
    {
      description: "指定リスト内のタスクを取得する",
      inputSchema: GetListTasksSchema,
    },
    async (input, { authInfo }) => {
      return toolResult(() =>
        operations.tasks.list(
          { userId: getUserId(authInfo), tabId: null },
          input,
        ),
      );
    },
  );

  server.registerTool(
    "tasks.listActive",
    {
      description: "ユーザーの全アクティブタスクを取得する（差分sync対応）",
      inputSchema: GetActiveTasksSchema,
    },
    async (input, { authInfo }) => {
      return toolResult(() =>
        operations.tasks.listActive(
          { userId: getUserId(authInfo), tabId: null },
          input,
        ),
      );
    },
  );

  server.registerTool(
    "tasks.create",
    { description: "新規タスクを追加する", inputSchema: CreateTaskSchema },
    async (input, { authInfo }) => {
      return toolResult(() =>
        operations.tasks.create(
          { userId: getUserId(authInfo), tabId: null },
          input,
        ),
      );
    },
  );

  server.registerTool(
    "tasks.update",
    {
      description: "既存タスクを更新する（テキスト・ステータス・タグ・移動）",
      inputSchema: UpdateTaskSchema,
    },
    async (input, { authInfo }) => {
      return toolResult(() =>
        operations.tasks.update(
          { userId: getUserId(authInfo), tabId: null },
          input,
        ),
      );
    },
  );

  server.registerTool(
    "tasks.search",
    {
      description:
        "全タスクを全文検索する（query は1～255文字、showType の既定値は active）",
      inputSchema: SearchTasksSchema,
    },
    async (input, { authInfo }) => {
      return toolResult(() =>
        operations.tasks.search(
          { userId: getUserId(authInfo), tabId: null },
          input,
        ),
      );
    },
  );

  server.registerTool(
    "tasks.reorder",
    {
      description: "リスト内のタスク並び順を更新する",
      inputSchema: ReorderTasksSchema,
    },
    async (input, { authInfo }) => {
      return toolResult(() =>
        operations.tasks.reorder(
          { userId: getUserId(authInfo), tabId: null },
          input,
        ),
      );
    },
  );

  // ── タイマー ──
  server.registerTool(
    "timers.list",
    { description: "タイマー一覧を取得する", inputSchema: z.object({}) },
    async (_input, { authInfo }) => {
      return toolResult(() =>
        operations.timers.list({
          userId: getUserId(authInfo),
          tabId: null,
        }),
      );
    },
  );

  server.registerTool(
    "timers.create",
    { description: "タイマーを新規作成する", inputSchema: CreateTimerSchema },
    async (input, { authInfo }) => {
      return toolResult(() =>
        operations.timers.create(
          { userId: getUserId(authInfo), tabId: null },
          input,
        ),
      );
    },
  );

  server.registerTool(
    "timers.update",
    { description: "タイマー設定を更新する", inputSchema: UpdateTimerSchema },
    async (input, { authInfo }) => {
      return toolResult(() =>
        operations.timers.update(
          { userId: getUserId(authInfo), tabId: null },
          input,
        ),
      );
    },
  );

  server.registerTool(
    "timers.delete",
    { description: "タイマーを削除する", inputSchema: TimerIdSchema },
    async (input, { authInfo }) => {
      return toolResult(() =>
        operations.timers.delete(
          { userId: getUserId(authInfo), tabId: null },
          input,
        ),
      );
    },
  );

  server.registerTool(
    "timers.start",
    {
      description:
        "タイマーを開始する（アラーム時はクライアントのTZオフセットを渡す）",
      inputSchema: StartTimerSchema,
    },
    async (input, { authInfo }) => {
      return toolResult(() =>
        operations.timers.start(
          { userId: getUserId(authInfo), tabId: null },
          input,
        ),
      );
    },
  );

  server.registerTool(
    "timers.pause",
    { description: "実行中タイマーを一時停止する", inputSchema: TimerIdSchema },
    async (input, { authInfo }) => {
      return toolResult(() =>
        operations.timers.pause(
          { userId: getUserId(authInfo), tabId: null },
          input,
        ),
      );
    },
  );

  server.registerTool(
    "timers.reset",
    {
      description: "タイマーを初期状態にリセットする",
      inputSchema: ResetTimerSchema,
    },
    async (input, { authInfo }) => {
      return toolResult(() =>
        operations.timers.reset(
          { userId: getUserId(authInfo), tabId: null },
          input,
        ),
      );
    },
  );

  server.registerTool(
    "timers.adjust",
    {
      description: "タイマーの残り時間を加算・減算する（minutes は正負の整数）",
      inputSchema: AdjustTimerSchema,
    },
    async (input, { authInfo }) => {
      return toolResult(() =>
        operations.timers.adjust(
          { userId: getUserId(authInfo), tabId: null },
          input,
        ),
      );
    },
  );

  server.registerTool(
    "timers.setTime",
    {
      description: "タイマーのベース時間・目標時刻を上書きする",
      inputSchema: SetTimerTimeSchema,
    },
    async (input, { authInfo }) => {
      return toolResult(() =>
        operations.timers.setTime(
          { userId: getUserId(authInfo), tabId: null },
          input,
        ),
      );
    },
  );

  server.registerTool(
    "timers.stop",
    {
      description: "鳴っているタイマーを止める（startedAt の不変条件を確認）",
      inputSchema: TimerStopSchema,
    },
    async (input, { authInfo }) => {
      return toolResult(() =>
        operations.timers.stop(
          { userId: getUserId(authInfo), tabId: null },
          input,
        ),
      );
    },
  );

  server.registerTool(
    "timers.reorder",
    {
      description: "タイマー並び順を更新する",
      inputSchema: ReorderTimersSchema,
    },
    async (input, { authInfo }) => {
      return toolResult(() =>
        operations.timers.reorder(
          { userId: getUserId(authInfo), tabId: null },
          input,
        ),
      );
    },
  );

  // ── カロリー（参照のみ） ──
  server.registerTool(
    "calories.summary",
    {
      description:
        "カロリーの集計（1日当たりペース・7日間平均・28日間平均・達成状況）を取得する（tzOffsetMinutes はUTCからの時差の分数で、日本時間は540）",
      inputSchema: GetCalorieSummarySchema,
    },
    async (input, { authInfo }) => {
      return toolResult(() =>
        operations.calories.summary(
          { userId: getUserId(authInfo), tabId: null },
          input,
        ),
      );
    },
  );

  server.registerTool(
    "calories.listRecords",
    {
      description:
        "カロリーの摂取記録を30日単位で新しい順に取得する（windowOffset は0で今日までの30日、1でその前の30日。tzOffsetMinutes はUTCからの時差の分数で、日本時間は540。品目表へ登録しない一時項目の記録は temporary が true で、quantity がkcal）",
      inputSchema: ListCalorieRecordsSchema,
    },
    async (input, { authInfo }) => {
      return toolResult(() =>
        operations.calories.records(
          { userId: getUserId(authInfo), tabId: null },
          input,
        ),
      );
    },
  );

  server.registerTool(
    "calories.listItems",
    {
      description: "カロリーの品目（名前・1個当たりのkcal・備考）を取得する",
      inputSchema: z.object({}),
    },
    async (_input, { authInfo }) => {
      return toolResult(() =>
        operations.calories.items({
          userId: getUserId(authInfo),
          tabId: null,
        }),
      );
    },
  );

  // ── 利用者設定 ──
  server.registerTool(
    "users.getPreferences",
    {
      description: "利用者の新規タイマーデフォルト値とカロリー目標値を取得する",
      inputSchema: z.object({}),
    },
    async (_input, { authInfo }) => {
      return toolResult(() =>
        operations.users.getPreferences({
          userId: getUserId(authInfo),
          tabId: null,
        }),
      );
    },
  );

  server.registerTool(
    "users.updatePreferences",
    {
      description:
        "利用者の新規タイマーデフォルト値とカロリー目標値のうち、指定した項目だけを更新する",
      inputSchema: UserPreferencesSchema,
    },
    async (input, { authInfo }) => {
      return toolResult(() =>
        operations.users.updatePreferences(
          { userId: getUserId(authInfo), tabId: null },
          input,
        ),
      );
    },
  );

  return server;
}
