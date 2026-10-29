/**
 * @fileoverview MCP サーバー定義
 *
 * 操作層の関数を MCP ツールとして公開する。
 * リスト・タスク・タイマー・利用者設定はtRPCルーター（`trpc.ts`）と同じ操作を網羅し、
 * カロリーは参照だけを公開する。
 *
 * ツールの説明と引数の説明（`schemas.ts`の`.describe()`）は、エージェントが似たツールを
 * 選び分けられるよう、返す内容と使い分ける相手のツール名を書く。
 * Claude Codeは初期送信で説明とinstructionsを4,096文字に切り詰めるため、各説明をその範囲に収める。
 */

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import { z } from "zod";
import * as operations from "../operations";
import type { OperationContext } from "../operations/context";
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

/**
 * ツール注釈の3区分。MCP仕様では読み取り専用でないツールの`destructiveHint`の既定値が真であり、
 * 追加だけを行う更新に限って偽にする。アーカイブや並べ替えのような可逆な更新も既存の状態を
 * 上書きするため破壊的として扱う。
 */
const READ_ONLY = { readOnlyHint: true } as const;
const ADDITIVE = { readOnlyHint: false, destructiveHint: false } as const;
const DESTRUCTIVE = { readOnlyHint: false, destructiveHint: true } as const;

/** AuthInfo.extra からアプリ内ユーザーIDを取り出す */
function getUserId(authInfo: AuthInfo | undefined): number {
  const userId = authInfo?.extra?.userId;
  if (typeof userId !== "number") {
    throw new Error("認証情報からユーザーIDが取得できません");
  }
  return userId;
}

/** MCP経由の操作は画面のタブを持たないため、送出元タブを空にする。 */
function operationContext(authInfo: AuthInfo | undefined): OperationContext {
  return { userId: getUserId(authInfo), tabId: null };
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
        "GLATasks のタスク・リスト・タイマーの操作と、カロリー記録の参照を提供する。" +
        "タスクは1つのリストに属し、タイマーはリストと独立している。" +
        "操作対象のIDは lists.list・tasks.list・tasks.listActive・tasks.search・timers.list で取得する。" +
        "日時はISO 8601形式のUTCで受け渡しする。" +
        "tzOffsetMinutes はUTCからの時差を分で表し、日本時間は540である。",
    },
  );

  // ── リスト ──
  server.registerTool(
    "lists.list",
    {
      title: "リスト一覧の取得",
      description:
        "リスト一覧をタイトル順で取得する。" +
        "各リストは id・title・status（active または archived）・todoCount（未完了のTODOタスク数）・lastUpdated を持つ。" +
        "リスト内のタスクは tasks.list で取得する。",
      inputSchema: z.object({
        showType: ShowTypeSchema.describe(
          "取得するリストの範囲。active は使用中のリストだけ、archived と all はアーカイブ済みを含む全リストを返す",
        ),
      }),
      annotations: READ_ONLY,
    },
    async (input, { authInfo }) => {
      return toolResult(() =>
        operations.lists.list(operationContext(authInfo), input.showType),
      );
    },
  );

  server.registerTool(
    "lists.create",
    {
      title: "リストの作成",
      description: "新しいリストを作成し、作成したリストのIDを listId で返す。",
      inputSchema: CreateListSchema,
      annotations: ADDITIVE,
    },
    async (input, { authInfo }) => {
      return toolResult(() =>
        operations.lists.create(operationContext(authInfo), input),
      );
    },
  );

  server.registerTool(
    "lists.rename",
    {
      title: "リスト名の変更",
      description:
        "指定したリストの名前を変更する。成功すると success: true だけを返す。",
      inputSchema: UpdateListSchema,
      annotations: DESTRUCTIVE,
    },
    async (input, { authInfo }) => {
      return toolResult(() =>
        operations.lists.rename(operationContext(authInfo), input),
      );
    },
  );

  server.registerTool(
    "lists.delete",
    {
      title: "リストの削除",
      description:
        "リストと、そのリストの全タスク・添付ファイル・定期TODOを削除する。削除したものは元に戻せない。" +
        "存在しないリストを指定しても成功し、何も変えない。" +
        "リストを残して一覧から外すには lists.archive、完了済みタスクだけを片付けるには lists.clear、" +
        "タスクを別のリストへ移してから元のリストを消すには lists.merge を使う。成功すると success: true だけを返す。",
      inputSchema: UpdateListSchema.pick({ listId: true }),
      annotations: DESTRUCTIVE,
    },
    async (input, { authInfo }) => {
      return toolResult(() =>
        operations.lists.delete(operationContext(authInfo), input),
      );
    },
  );

  server.registerTool(
    "lists.archive",
    {
      title: "リストのアーカイブ",
      description:
        "リストをアーカイブ済みにし、使用中のリストの一覧と tasks.listActive の対象から外す。" +
        "タスクは削除せず、lists.unarchive で使用中に戻せる。" +
        "リスト内の完了済みタスクだけをアーカイブするには lists.clear、リストごと削除するには lists.delete、" +
        "タスクを別のリストへ統合するには lists.merge を使う。成功すると success: true だけを返す。",
      inputSchema: UpdateListSchema.pick({ listId: true }),
      annotations: DESTRUCTIVE,
    },
    async (input, { authInfo }) => {
      return toolResult(() =>
        operations.lists.archive(operationContext(authInfo), input),
      );
    },
  );

  server.registerTool(
    "lists.unarchive",
    {
      title: "リストのアーカイブ解除",
      description:
        "アーカイブ済みのリストを使用中（active）に戻す。成功すると success: true だけを返す。",
      inputSchema: UpdateListSchema.pick({ listId: true }),
      annotations: DESTRUCTIVE,
    },
    async (input, { authInfo }) => {
      return toolResult(() =>
        operations.lists.unarchive(operationContext(authInfo), input),
      );
    },
  );

  server.registerTool(
    "lists.clear",
    {
      title: "完了済みタスクのアーカイブ",
      description:
        "リスト内の完了済み（completed）タスクをまとめてアーカイブし、リストと未完了のタスクは残す。" +
        "アーカイブしたタスクは tasks.list の showType を archived にすると取得できる。" +
        "リスト自体をアーカイブするには lists.archive、リストを削除するには lists.delete、" +
        "別のリストへ統合するには lists.merge を使う。成功すると success: true だけを返す。",
      inputSchema: UpdateListSchema.pick({ listId: true }),
      annotations: DESTRUCTIVE,
    },
    async (input, { authInfo }) => {
      return toolResult(() =>
        operations.lists.clear(operationContext(authInfo), input),
      );
    },
  );

  server.registerTool(
    "lists.merge",
    {
      title: "リストの統合",
      description:
        "統合元（sourceListId）の全タスクと定期TODOを統合先（targetListId）へ移し、統合元のリストを削除する。" +
        "両方とも使用中（active）のリストである必要がある。" +
        "統合後のタスクは各リスト内の順序を保ち、更新日時の新しい順に交互に並ぶ。" +
        "タスクを移さずにリストを消すには lists.delete、リストを残して一覧から外すには lists.archive、" +
        "完了済みタスクの片付けには lists.clear を使う。成功すると success: true だけを返す。",
      inputSchema: MergeListSchema,
      annotations: DESTRUCTIVE,
    },
    async (input, { authInfo }) => {
      return toolResult(() =>
        operations.lists.merge(operationContext(authInfo), input),
      );
    },
  );

  // ── タスク ──
  server.registerTool(
    "tasks.list",
    {
      title: "リスト内のタスクの取得",
      description:
        "1つのリスト内のタスクを並び順で取得する。" +
        "通常は status: 200 と、data（各タスクの id・title（本文の1行目）・notes（2行目以降）・status・kind・tags・attachments）、" +
        "lastModified（リストの最終更新日時）を返す。" +
        "ifModifiedSince 以降にリストが変更されていなければ status: 304 だけを返す。" +
        "使用中の全リストのアーカイブ済み以外のタスクをまとめて取得するには tasks.listActive、" +
        "本文の語句で複数のリストから探すには tasks.search を使う。",
      inputSchema: GetListTasksSchema,
      annotations: READ_ONLY,
    },
    async (input, { authInfo }) => {
      return toolResult(() =>
        operations.tasks.list(operationContext(authInfo), input),
      );
    },
  );

  server.registerTool(
    "tasks.listActive",
    {
      title: "全リストのタスクの取得",
      description:
        "使用中（active）の全リストのタスクを1回で取得する。" +
        "since を省略するとアーカイブ済み以外の全タスクを返し（mode: full）、" +
        "指定するとその日時以降に更新されたタスクをアーカイブ済みも含めて返す（mode: delta）。" +
        "各タスクは tasks.list と同じ項目に加えて listId・sortOrder・updated を持つ。" +
        "続けて差分を取得するときは、返された serverTime を次の since に渡す。" +
        "1つのリストだけを取得するには tasks.list、本文の語句で探すには tasks.search を使う。",
      inputSchema: GetActiveTasksSchema,
      annotations: READ_ONLY,
    },
    async (input, { authInfo }) => {
      return toolResult(() =>
        operations.tasks.listActive(operationContext(authInfo), input),
      );
    },
  );

  server.registerTool(
    "tasks.create",
    {
      title: "タスクの追加",
      description:
        "指定したリストの先頭にタスクを追加し、作成したタスクのIDを taskId で返す。" +
        "text の1行目がタイトル、2行目以降が備考になる。",
      inputSchema: CreateTaskSchema,
      annotations: ADDITIVE,
    },
    async (input, { authInfo }) => {
      return toolResult(() =>
        operations.tasks.create(operationContext(authInfo), input),
      );
    },
  );

  server.registerTool(
    "tasks.update",
    {
      title: "タスクの更新",
      description:
        "既存タスクの本文・状態・完了日時・タグ・種別を変更するか、別のリストへ移動する。指定した項目だけを更新する。" +
        "status を completed にすると完了日時を記録する。" +
        "MCPからタスクは削除できないため、不要なタスクは status を archived にする。成功すると success: true だけを返す。",
      inputSchema: UpdateTaskSchema,
      annotations: DESTRUCTIVE,
    },
    async (input, { authInfo }) => {
      return toolResult(() =>
        operations.tasks.update(operationContext(authInfo), input),
      );
    },
  );

  server.registerTool(
    "tasks.search",
    {
      title: "タスクの検索",
      description:
        "本文に query を部分一致で含むタスクを、showType で選んだ範囲のリストから探し、一致した全件を返す。" +
        "showType を省略すると使用中のリストだけを探す。" +
        "各タスクは tasks.list と同じ項目に加えて listId・listTitle を持つ。" +
        "1つのリストの全タスクを取得するには tasks.list、" +
        "使用中の全リストのアーカイブ済み以外のタスクをまとめて取得するには tasks.listActive を使う。",
      inputSchema: SearchTasksSchema,
      annotations: READ_ONLY,
    },
    async (input, { authInfo }) => {
      return toolResult(() =>
        operations.tasks.search(operationContext(authInfo), input),
      );
    },
  );

  server.registerTool(
    "tasks.reorder",
    {
      title: "タスクの並べ替え",
      description:
        "taskIds に並べた順で、リスト内のタスクの並び順を付け直す。" +
        "通常はリスト内の全タスクのIDを指定する。他のリストのタスクのIDは無視する。成功すると success: true だけを返す。",
      inputSchema: ReorderTasksSchema,
      annotations: DESTRUCTIVE,
    },
    async (input, { authInfo }) => {
      return toolResult(() =>
        operations.tasks.reorder(operationContext(authInfo), input),
      );
    },
  );

  // ── タイマー ──
  server.registerTool(
    "timers.list",
    {
      title: "タイマー一覧の取得",
      description:
        "全タイマーとアラームを並び順で取得する。" +
        "timers（各タイマーの id・name・mode・baseSeconds・targetMinutes・adjustMinutes・ringSeconds・" +
        "remainingSeconds・running・expired・ephemeral・startedAt）と、サーバーの現在時刻 serverTime を返す。" +
        "実行中のタイマーの残り秒数は remainingSeconds から startedAt 以降の経過秒数を引いた値になる。" +
        "時間切れになった実行中のタイマーは、停止した満了状態にしてから返す。",
      inputSchema: z.object({}),
      annotations: READ_ONLY,
    },
    async (_input, { authInfo }) => {
      return toolResult(() =>
        operations.timers.list(operationContext(authInfo)),
      );
    },
  );

  server.registerTool(
    "timers.create",
    {
      title: "タイマーの作成",
      description:
        "カウントダウンタイマー（mode: countdown）またはアラーム（mode: alarm）を一覧の末尾に作成する。" +
        "アラームと1回限りのタイマー（ephemeral: true）は作成と同時に開始し、それ以外は停止状態で作成する。" +
        "成功すると success: true だけを返し、作成したタイマーのIDは含まないため、IDは timers.list で取得する。",
      inputSchema: CreateTimerSchema,
      annotations: ADDITIVE,
    },
    async (input, { authInfo }) => {
      return toolResult(() =>
        operations.timers.create(operationContext(authInfo), input),
      );
    },
  );

  server.registerTool(
    "timers.update",
    {
      title: "タイマー設定の変更",
      description:
        "タイマーの名前・モード・時間・延長幅・鳴動時間を変更する。指定した項目だけを更新する。" +
        "モードの変更は停止中だけ受け付ける。" +
        "今回の残り時間だけを変えるには timers.setTime または timers.adjust を使う。成功すると success: true だけを返す。",
      inputSchema: UpdateTimerSchema,
      annotations: DESTRUCTIVE,
    },
    async (input, { authInfo }) => {
      return toolResult(() =>
        operations.timers.update(operationContext(authInfo), input),
      );
    },
  );

  server.registerTool(
    "timers.delete",
    {
      title: "タイマーの削除",
      description:
        "指定したタイマーを削除する。成功すると success: true だけを返す。",
      inputSchema: TimerIdSchema,
      annotations: DESTRUCTIVE,
    },
    async (input, { authInfo }) => {
      return toolResult(() =>
        operations.timers.delete(operationContext(authInfo), input),
      );
    },
  );

  server.registerTool(
    "timers.start",
    {
      title: "タイマーの開始",
      description:
        "停止中のタイマーを現在の残り時間から開始する。" +
        "アラームは開始時に目標時刻までの秒数を計算し直すため tzOffsetMinutes が必要になる。" +
        "実行中のタイマーと残り0秒のカウントダウンには何もしない。成功すると success: true だけを返す。",
      inputSchema: StartTimerSchema,
      annotations: DESTRUCTIVE,
    },
    async (input, { authInfo }) => {
      return toolResult(() =>
        operations.timers.start(operationContext(authInfo), input),
      );
    },
  );

  server.registerTool(
    "timers.pause",
    {
      title: "タイマーの一時停止",
      description:
        "実行中のタイマーを一時停止し、その時点の残り時間を保つ。timers.start で再開できる。" +
        "残り0秒の満了状態にして止めるには timers.stop、初期の時間へ戻すには timers.reset、" +
        "残り時間を指定した値にするには timers.setTime、分単位で増減するには timers.adjust を使う。成功すると success: true だけを返す。",
      inputSchema: TimerIdSchema,
      annotations: DESTRUCTIVE,
    },
    async (input, { authInfo }) => {
      return toolResult(() =>
        operations.timers.pause(operationContext(authInfo), input),
      );
    },
  );

  server.registerTool(
    "timers.reset",
    {
      title: "タイマーのリセット",
      description:
        "タイマーを停止して初期の時間へ戻す。" +
        "カウントダウンは baseSeconds に戻し、停止中で既に baseSeconds と同じなら0秒にする（交互に切り替わる）。" +
        "アラームは次の目標時刻までの秒数に戻すため tzOffsetMinutes が必要になる。" +
        "残り時間を保って止めるには timers.pause、満了状態にして止めるには timers.stop、" +
        "残り時間を指定した値にするには timers.setTime、分単位で増減するには timers.adjust を使う。成功すると success: true だけを返す。",
      inputSchema: ResetTimerSchema,
      annotations: DESTRUCTIVE,
    },
    async (input, { authInfo }) => {
      return toolResult(() =>
        operations.timers.reset(operationContext(authInfo), input),
      );
    },
  );

  server.registerTool(
    "timers.adjust",
    {
      title: "残り時間の増減",
      description:
        "タイマーの残り時間を minutes 分だけ増減する。実行中でも使え、残り時間は0秒未満にならない。" +
        "アラームでは目標時刻も同じ分だけずらす。" +
        "残り時間を指定した値にするには timers.setTime、初期の時間へ戻すには timers.reset、" +
        "一時停止には timers.pause、満了状態にして止めるには timers.stop を使う。成功すると success: true だけを返す。",
      inputSchema: AdjustTimerSchema,
      annotations: DESTRUCTIVE,
    },
    async (input, { authInfo }) => {
      return toolResult(() =>
        operations.timers.adjust(operationContext(authInfo), input),
      );
    },
  );

  server.registerTool(
    "timers.setTime",
    {
      title: "残り時間の設定",
      description:
        "停止中のタイマーの残り時間を seconds に設定する。リセット時に戻る baseSeconds は変えない。" +
        "アラームで targetMinutes と tzOffsetMinutes を渡すと、目標時刻を変えて残り時間をその時刻から計算する。" +
        "実行中のタイマーには使えない。" +
        "現在の残り時間から増減するには timers.adjust、初期の時間へ戻すには timers.reset、" +
        "一時停止には timers.pause、満了状態にして止めるには timers.stop を使う。成功すると success: true だけを返す。",
      inputSchema: SetTimerTimeSchema,
      annotations: DESTRUCTIVE,
    },
    async (input, { authInfo }) => {
      return toolResult(() =>
        operations.timers.setTime(operationContext(authInfo), input),
      );
    },
  );

  server.registerTool(
    "timers.stop",
    {
      title: "タイマーの満了",
      description:
        "実行中のタイマーを残り0秒の満了状態（expired: true）にして止める。" +
        "画面が残り0秒に達したタイマーへ使う操作で、停止中のタイマーには何もしない。" +
        "残り時間を保って止めるには timers.pause、初期の時間へ戻すには timers.reset を使い、" +
        "残り時間を変えるには timers.setTime か timers.adjust を使う。成功すると success: true だけを返す。",
      inputSchema: TimerStopSchema,
      annotations: DESTRUCTIVE,
    },
    async (input, { authInfo }) => {
      return toolResult(() =>
        operations.timers.stop(operationContext(authInfo), input),
      );
    },
  );

  server.registerTool(
    "timers.reorder",
    {
      title: "タイマーの並べ替え",
      description:
        "timerIds に並べた順でタイマーを並べ替える。利用者の全タイマーのIDを過不足なく指定する。成功すると success: true だけを返す。",
      inputSchema: ReorderTimersSchema,
      annotations: DESTRUCTIVE,
    },
    async (input, { authInfo }) => {
      return toolResult(() =>
        operations.timers.reorder(operationContext(authInfo), input),
      );
    },
  );

  // ── カロリー（参照のみ） ──
  server.registerTool(
    "calories.summary",
    {
      title: "カロリーの集計",
      description:
        "カロリー摂取の集計を取得する。" +
        "goalKcal（1日の目標kcal）、periods（直近1日のペース・7日間平均・28日間平均について、1日当たりのkcalと目標に対する%）、" +
        "achievement（過去28日の日ごとの7日間平均と達成状況、連続達成日数、前週との差、今日の残りkcal）を返す。" +
        "個々の摂取記録は calories.listRecords、品目の一覧は calories.listItems で取得する。",
      inputSchema: GetCalorieSummarySchema,
      annotations: READ_ONLY,
    },
    async (input, { authInfo }) => {
      return toolResult(() =>
        operations.calories.summary(operationContext(authInfo), input),
      );
    },
  );

  server.registerTool(
    "calories.listRecords",
    {
      title: "カロリーの摂取記録の取得",
      description:
        "カロリーの摂取記録を30日単位で新しい順に取得する。" +
        "各記録は id・itemId・itemName・itemKcal・consumedAt・quantity・totalKcal・temporary を持つ。" +
        "temporary が true の記録は品目表へ登録しない一時項目で、quantity がそのままkcalになる。" +
        "期間の集計値は calories.summary、品目の一覧は calories.listItems で取得する。",
      inputSchema: ListCalorieRecordsSchema,
      annotations: READ_ONLY,
    },
    async (input, { authInfo }) => {
      return toolResult(() =>
        operations.calories.records(operationContext(authInfo), input),
      );
    },
  );

  server.registerTool(
    "calories.listItems",
    {
      title: "カロリーの品目の取得",
      description:
        "カロリーの品目を名前順で全件取得する。" +
        "各品目は id・name・kcal（1個当たり）・note（備考）・recordCount（摂取記録の件数）・autoRecordCount（自動記録の件数）を持つ。" +
        "摂取記録は calories.listRecords、期間の集計値は calories.summary で取得する。",
      inputSchema: z.object({}),
      annotations: READ_ONLY,
    },
    async (_input, { authInfo }) => {
      return toolResult(() =>
        operations.calories.items(operationContext(authInfo)),
      );
    },
  );

  // ── 利用者設定 ──
  server.registerTool(
    "users.getPreferences",
    {
      title: "利用者設定の取得",
      description:
        "新規タイマーの既定値（ringSeconds・baseSeconds・adjustMinutes・mode）と、カロリーの1日の目標値 calorieGoalKcal を取得する。" +
        "設定していない項目は返さない。",
      inputSchema: z.object({}),
      annotations: READ_ONLY,
    },
    async (_input, { authInfo }) => {
      return toolResult(() =>
        operations.users.getPreferences(operationContext(authInfo)),
      );
    },
  );

  server.registerTool(
    "users.updatePreferences",
    {
      title: "利用者設定の更新",
      description:
        "新規タイマーの既定値とカロリーの1日の目標値のうち、指定した項目だけを更新する。省略した項目は現在の値を保つ。成功すると success: true だけを返す。",
      inputSchema: UserPreferencesSchema,
      annotations: DESTRUCTIVE,
    },
    async (input, { authInfo }) => {
      return toolResult(() =>
        operations.users.updatePreferences(operationContext(authInfo), input),
      );
    },
  );

  return server;
}
