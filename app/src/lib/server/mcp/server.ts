/**
 * @fileoverview MCP サーバー定義
 *
 * `app/src/lib/server/api/` 配下の関数を MCP ツールとして公開する。
 * tRPC ルーター（`trpc.ts`）と同じ24件の操作を網羅する。
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { z } from "zod";
import * as api from "../api";
import { sendEvent } from "../sse";
import { SSE_EVENTS } from "$lib/sse-events";
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
} from "$lib/schemas";

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

function successResult(extra?: Record<string, unknown>) {
  return jsonResult({ success: true, ...extra });
}

export function createMcpServer(): McpServer {
  const server = new McpServer(
    { name: "glatasks", version: "1.0.0" },
    {
      capabilities: { tools: {} },
      instructions:
        "GLATasks のタスク・リスト・タイマー操作を提供する。" +
        "タスクは複数のリストに属し、タイマーは独立して動作する。",
    },
  );

  // ── リスト ──
  server.registerTool(
    "lists.list",
    { description: "リスト一覧を取得する", inputSchema: ShowTypeSchema },
    async (input, { authInfo }) => {
      const result = await api.getLists(getUserId(authInfo), input);
      return jsonResult(result);
    },
  );

  server.registerTool(
    "lists.create",
    { description: "新規リストを作成する", inputSchema: CreateListSchema },
    async (input, { authInfo }) => {
      const userId = getUserId(authInfo);
      await api.postList(userId, input.title);
      sendEvent(userId, SSE_EVENTS.listsUpdated, null);
      return successResult();
    },
  );

  server.registerTool(
    "lists.rename",
    { description: "リスト名を変更する", inputSchema: UpdateListSchema },
    async (input, { authInfo }) => {
      const userId = getUserId(authInfo);
      await api.renameList(userId, input.listId, input.title);
      sendEvent(userId, SSE_EVENTS.listsUpdated, null);
      return successResult();
    },
  );

  server.registerTool(
    "lists.delete",
    {
      description: "リストとその全タスクを削除する",
      inputSchema: UpdateListSchema.pick({ listId: true }),
    },
    async (input, { authInfo }) => {
      const userId = getUserId(authInfo);
      await api.deleteList(userId, input.listId);
      sendEvent(userId, SSE_EVENTS.listsUpdated, null);
      return successResult();
    },
  );

  server.registerTool(
    "lists.archive",
    {
      description: "リストをアーカイブする",
      inputSchema: UpdateListSchema.pick({ listId: true }),
    },
    async (input, { authInfo }) => {
      const userId = getUserId(authInfo);
      await api.archiveList(userId, input.listId);
      sendEvent(userId, SSE_EVENTS.listsUpdated, null);
      return successResult();
    },
  );

  server.registerTool(
    "lists.unarchive",
    {
      description: "アーカイブ済みリストを active に戻す",
      inputSchema: UpdateListSchema.pick({ listId: true }),
    },
    async (input, { authInfo }) => {
      const userId = getUserId(authInfo);
      await api.unarchiveList(userId, input.listId);
      sendEvent(userId, SSE_EVENTS.listsUpdated, null);
      return successResult();
    },
  );

  server.registerTool(
    "lists.clear",
    {
      description: "リスト内の完了済みタスクをアーカイブする",
      inputSchema: UpdateListSchema.pick({ listId: true }),
    },
    async (input, { authInfo }) => {
      const userId = getUserId(authInfo);
      await api.clearList(userId, input.listId);
      sendEvent(userId, SSE_EVENTS.tasksUpdated, null);
      return successResult();
    },
  );

  server.registerTool(
    "lists.merge",
    {
      description: "リスト同士を統合する（source の全タスクを target に移動）",
      inputSchema: MergeListSchema,
    },
    async (input, { authInfo }) => {
      const userId = getUserId(authInfo);
      await api.mergeLists(userId, input.sourceListId, input.targetListId);
      sendEvent(userId, SSE_EVENTS.listsUpdated, null);
      sendEvent(userId, SSE_EVENTS.tasksUpdated, null);
      return successResult();
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
      const result = await api.getListTasks(
        getUserId(authInfo),
        input.listId,
        input.showType,
        input.ifModifiedSince,
      );
      return jsonResult(result);
    },
  );

  server.registerTool(
    "tasks.listActive",
    {
      description: "ユーザーの全アクティブタスクを取得する（差分sync対応）",
      inputSchema: GetActiveTasksSchema,
    },
    async (input, { authInfo }) => {
      const since = input.since ? new Date(input.since) : undefined;
      const result = await api.getActiveTasks(getUserId(authInfo), since);
      return jsonResult(result);
    },
  );

  server.registerTool(
    "tasks.create",
    { description: "新規タスクを追加する", inputSchema: CreateTaskSchema },
    async (input, { authInfo }) => {
      const userId = getUserId(authInfo);
      const taskId = await api.postTask(
        userId,
        input.listId,
        input.text,
        input.tags,
        input.kind,
      );
      sendEvent(userId, SSE_EVENTS.tasksUpdated, null);
      return jsonResult({ success: true, taskId });
    },
  );

  server.registerTool(
    "tasks.update",
    {
      description: "既存タスクを更新する（テキスト・ステータス・タグ・移動）",
      inputSchema: UpdateTaskSchema,
    },
    async (input, { authInfo }) => {
      const userId = getUserId(authInfo);
      const { listId, taskId, ...data } = input;
      await api.patchTask(userId, listId, taskId, data);
      sendEvent(userId, SSE_EVENTS.tasksUpdated, null);
      return successResult();
    },
  );

  server.registerTool(
    "tasks.search",
    {
      description: "全タスクを全文検索する（query は1～255文字）",
      inputSchema: SearchTasksSchema,
    },
    async (input, { authInfo }) => {
      const result = await api.searchTasks(getUserId(authInfo), input.query);
      return jsonResult(result);
    },
  );

  server.registerTool(
    "tasks.reorder",
    {
      description: "リスト内のタスク並び順を更新する",
      inputSchema: ReorderTasksSchema,
    },
    async (input, { authInfo }) => {
      const userId = getUserId(authInfo);
      await api.reorderTasks(userId, input.listId, input.taskIds);
      sendEvent(userId, SSE_EVENTS.tasksUpdated, null);
      return successResult();
    },
  );

  // ── タイマー ──
  server.registerTool(
    "timers.list",
    { description: "タイマー一覧を取得する", inputSchema: z.object({}) },
    async (_input, { authInfo }) => {
      const result = await api.getTimers(getUserId(authInfo));
      return jsonResult(result);
    },
  );

  server.registerTool(
    "timers.create",
    { description: "タイマーを新規作成する", inputSchema: CreateTimerSchema },
    async (input, { authInfo }) => {
      const userId = getUserId(authInfo);
      await api.createTimer({
        userId,
        name: input.name,
        baseSeconds: input.base_seconds,
        adjustMinutes: input.adjust_minutes,
        mode: input.mode,
        targetMinutes: input.target_minutes ?? null,
        tzOffsetMinutes: input.tz_offset_minutes ?? null,
        ephemeral: input.ephemeral,
        ringSeconds: input.ring_seconds,
      });
      sendEvent(userId, SSE_EVENTS.timersUpdated, null);
      return successResult();
    },
  );

  server.registerTool(
    "timers.update",
    { description: "タイマー設定を更新する", inputSchema: UpdateTimerSchema },
    async (input, { authInfo }) => {
      const userId = getUserId(authInfo);
      const { timerId, ...data } = input;
      await api.updateTimer(userId, timerId, data);
      sendEvent(userId, SSE_EVENTS.timersUpdated, null);
      return successResult();
    },
  );

  server.registerTool(
    "timers.delete",
    { description: "タイマーを削除する", inputSchema: TimerIdSchema },
    async (input, { authInfo }) => {
      const userId = getUserId(authInfo);
      await api.deleteTimer(userId, input.timerId);
      sendEvent(userId, SSE_EVENTS.timersUpdated, null);
      return successResult();
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
      const userId = getUserId(authInfo);
      await api.startTimer(userId, input.timerId, input.tz_offset_minutes);
      sendEvent(userId, SSE_EVENTS.timersUpdated, null);
      return successResult();
    },
  );

  server.registerTool(
    "timers.pause",
    { description: "実行中タイマーを一時停止する", inputSchema: TimerIdSchema },
    async (input, { authInfo }) => {
      const userId = getUserId(authInfo);
      await api.pauseTimer(userId, input.timerId);
      sendEvent(userId, SSE_EVENTS.timersUpdated, null);
      return successResult();
    },
  );

  server.registerTool(
    "timers.reset",
    {
      description: "タイマーを初期状態にリセットする",
      inputSchema: ResetTimerSchema,
    },
    async (input, { authInfo }) => {
      const userId = getUserId(authInfo);
      await api.resetTimer(userId, input.timerId, input.tz_offset_minutes);
      sendEvent(userId, SSE_EVENTS.timersUpdated, null);
      return successResult();
    },
  );

  server.registerTool(
    "timers.adjust",
    {
      description: "タイマーの残り時間を加算・減算する（minutes は正負の整数）",
      inputSchema: AdjustTimerSchema,
    },
    async (input, { authInfo }) => {
      const userId = getUserId(authInfo);
      await api.adjustTimer(userId, input.timerId, input.minutes);
      sendEvent(userId, SSE_EVENTS.timersUpdated, null);
      return successResult();
    },
  );

  server.registerTool(
    "timers.setTime",
    {
      description: "タイマーのベース時間・目標時刻を上書きする",
      inputSchema: SetTimerTimeSchema,
    },
    async (input, { authInfo }) => {
      const userId = getUserId(authInfo);
      await api.setTimerTime(
        userId,
        input.timerId,
        input.seconds,
        input.target_minutes,
        input.tz_offset_minutes,
      );
      sendEvent(userId, SSE_EVENTS.timersUpdated, null);
      return successResult();
    },
  );

  server.registerTool(
    "timers.stop",
    {
      description: "鳴っているタイマーを止める（started_at の不変条件を確認）",
      inputSchema: TimerStopSchema,
    },
    async (input, { authInfo }) => {
      const userId = getUserId(authInfo);
      await api.stopTimer(userId, input.timerId, input.started_at);
      sendEvent(userId, SSE_EVENTS.timersUpdated, null);
      return successResult();
    },
  );

  server.registerTool(
    "timers.reorder",
    {
      description: "タイマー並び順を更新する",
      inputSchema: ReorderTimersSchema,
    },
    async (input, { authInfo }) => {
      const userId = getUserId(authInfo);
      await api.reorderTimers(userId, input.timerIds);
      sendEvent(userId, SSE_EVENTS.timersUpdated, null);
      return successResult();
    },
  );

  // ── 利用者設定 ──
  server.registerTool(
    "users.getPreferences",
    {
      description: "利用者の新規タイマーデフォルト値を取得する",
      inputSchema: z.object({}),
    },
    async (_input, { authInfo }) => {
      const result = await api.getUserPreferences(getUserId(authInfo));
      return jsonResult(result);
    },
  );

  server.registerTool(
    "users.updatePreferences",
    {
      description: "利用者の新規タイマーデフォルト値を更新する",
      inputSchema: UserPreferencesSchema,
    },
    async (input, { authInfo }) => {
      const userId = getUserId(authInfo);
      await api.updateUserPreferences(userId, input);
      sendEvent(userId, SSE_EVENTS.usersPreferencesUpdated, null);
      return successResult();
    },
  );

  return server;
}
