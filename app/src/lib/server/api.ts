/**
 * @fileoverview DB 直接アクセスによるビジネスロジック（Drizzle ORM）
 */

import bcrypt from "bcryptjs";
import { and, asc, eq, inArray, like, max, min } from "drizzle-orm";

import { adjustUpdatedTimestamps, mergeByTimestamp } from "./merge-utils";

import type {
  ListInfo,
  TaskInfo,
  TimerInfo,
  SearchTaskResult,
  GetTasksResult,
} from "$lib/types";
import { getDb } from "./db";
import { lists, tasks, timers, users } from "./schema";

// ── 型定義（SSOT は $lib/types.ts、ここには api.ts 固有の型のみ） ──

export type { ListInfo, TaskInfo, TimerInfo, SearchTaskResult, GetTasksResult };

export type TaskPatchResult = {
  status: string;
  completed: string | null;
  list_id: number;
  title: string;
  notes: string;
};

export type UserInfo = {
  id: number;
  user: string;
};

// ── 日時変換ヘルパー ──

/**
 * DB の TIMESTAMP 型から読み込んだ Date を UTC ISO 文字列に変換する。
 *
 * TIMESTAMP 型は内部的に UTC で保存され、mysql2 が Date オブジェクトとして返す。
 * toISOString() でそのまま UTC 表現になる。
 */
function toUtcIso(dt: Date): string {
  return dt.toISOString();
}

/**
 * クライアントから受け取った UTC ISO 文字列を DB に保存する Date に変換する。
 *
 * new Date(isoString) で UTC ミリ秒の Date を生成し、
 * TIMESTAMP 型に INSERT すると MariaDB が UTC として格納する。
 */
function fromUtcIso(isoStr: string): Date {
  return new Date(isoStr);
}

// ── タスクの title/notes 分割 ──

function splitTitle(text: string): string {
  return text
    .split("\n", 1)[0]
    .replace(/^[\r\n]+/, "")
    .trimEnd();
}

function splitNotes(text: string): string {
  const idx = text.indexOf("\n");
  return idx === -1
    ? ""
    : text
        .slice(idx + 1)
        .replace(/^[\r\n]+/, "")
        .trimEnd();
}

// ── DB 更新ヘルパー ──

/** リストの last_updated を現在時刻に更新する */
async function touchListUpdated(listId: number): Promise<void> {
  const db = getDb();
  await db
    .update(lists)
    .set({ last_updated: new Date() })
    .where(eq(lists.id, listId));
}

// ── 所有権チェック ──

async function getOwnedList(listId: number, userId: number) {
  const db = getDb();
  const rows = await db
    .select()
    .from(lists)
    .where(and(eq(lists.id, listId), eq(lists.user_id, userId)))
    .limit(1);
  if (rows.length === 0) throw new Error("not_found_or_forbidden");
  return rows[0];
}

// ── 認証 ──

/** ログイン認証。成功時にユーザー情報を返し、失敗時に null を返す。 */
export async function validateCredentials(
  user: string,
  password: string,
): Promise<UserInfo | null> {
  const db = getDb();
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.user, user))
    .limit(1);
  if (rows.length === 0) return null;
  const row = rows[0];
  const ok = await bcrypt.compare(password, row.pass_hash);
  if (!ok) return null;
  await db
    .update(users)
    .set({ last_login: new Date() })
    .where(eq(users.id, row.id));
  return { id: row.id, user: row.user };
}

/** ユーザー登録。バリデーション失敗時は Error を throw する。 */
export async function registerUser(
  userId: string,
  password: string,
): Promise<UserInfo> {
  if (!/^[a-zA-Z0-9]{4,32}$/.test(userId)) {
    throw new Error("ユーザーIDは4～32文字の英数字としてください。");
  }
  if (password.length === 0) {
    throw new Error("パスワードは必須です。");
  }
  const db = getDb();
  const existing = await db
    .select()
    .from(users)
    .where(eq(users.user, userId))
    .limit(1);
  if (existing.length > 0) {
    throw new Error("既に存在するユーザーIDです。");
  }
  const passHash = await bcrypt.hash(password, 10);
  const result = await db
    .insert(users)
    .values({ user: userId, pass_hash: passHash, joined: new Date() });
  return { id: Number(result[0].insertId), user: userId };
}

// ── リスト操作 ──

/** リスト一覧を取得する。タイトル昇順で返す。 */
export async function getLists(
  userId: number,
  showType: string,
): Promise<ListInfo[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(lists)
    .where(eq(lists.user_id, userId))
    .orderBy(asc(lists.title));
  return rows
    .filter((r) => {
      if (showType === "active") return r.status === "active";
      // "archived" と "all" では全リストを表示
      // （アーカイブ表示でアクティブなリスト内のアーカイブ済みタスクも確認できるようにする）
      return true;
    })
    .map((r) => ({
      id: r.id,
      title: r.title,
      sort_order: r.sort_order,
      last_updated: toUtcIso(r.last_updated),
      status: r.status,
    }));
}

/** リストのタスク一覧を取得する（If-Modified-Since キャッシュ対応）。 */
export async function getListTasks(
  userId: number,
  listId: number,
  showType: string,
  ifModifiedSince?: string,
): Promise<GetTasksResult> {
  const list = await getOwnedList(listId, userId);

  if (ifModifiedSince) {
    try {
      const clientMs = new Date(ifModifiedSince).getTime();
      const serverMs = list.last_updated.getTime();
      if (serverMs <= clientMs) return { status: 304 };
    } catch {
      // パースに失敗した場合は通常のレスポンスを返す
    }
  }

  const db = getDb();
  const allTasks = await db
    .select()
    .from(tasks)
    .where(eq(tasks.list_id, listId))
    .orderBy(asc(tasks.sort_order));

  const data: TaskInfo[] = allTasks
    .filter((t) => {
      if (showType === "all") return true;
      if (showType === "active") return t.status !== "archived";
      if (showType === "archived") return t.status === "archived";
      return true;
    })
    .map((t) => ({
      id: t.id,
      title: splitTitle(t.text),
      notes: splitNotes(t.text),
      status: t.status,
    }));

  const lastModified = toUtcIso(list.last_updated);
  return { status: 200, data, lastModified };
}

/** リストを作成する。sort_order は既存の最小値 - 1000（先頭追加）。 */
export async function postList(userId: number, title: string): Promise<void> {
  if (title.length === 0) throw new Error("タイトルは必須です。");
  const db = getDb();
  // 現在の最小 sort_order を取得
  const [{ minOrder }] = await db
    .select({ minOrder: min(lists.sort_order) })
    .from(lists)
    .where(eq(lists.user_id, userId));
  const sortOrder = (minOrder ?? 1000) - 1000;
  await db.insert(lists).values({
    title,
    user_id: userId,
    status: "active",
    sort_order: sortOrder,
    last_updated: new Date(),
  });
}

/** 完了済みタスクを archived にする。 */
export async function clearList(userId: number, listId: number): Promise<void> {
  await getOwnedList(listId, userId);
  const db = getDb();
  await db
    .update(tasks)
    .set({ status: "archived" })
    .where(and(eq(tasks.list_id, listId), eq(tasks.status, "completed")));
  await touchListUpdated(listId);
}

/** リスト名を変更する。 */
export async function renameList(
  userId: number,
  listId: number,
  title: string,
): Promise<void> {
  if (title.length === 0) throw new Error("タイトルは必須です。");
  await getOwnedList(listId, userId);
  const db = getDb();
  await db.update(lists).set({ title }).where(eq(lists.id, listId));
  await touchListUpdated(listId);
}

/** リストとその全タスクを削除する。 */
export async function deleteList(
  userId: number,
  listId: number,
): Promise<void> {
  // 冪等な削除: 対象が無い・他ユーザーのものは no-op (NOT_FOUND を返さない)。
  // 別端末で先に削除されていた場合のレース時に、こちらの削除がエラーにならず
  // クライアントの状態を確実に整合させるため。
  // schema.ts に ON DELETE CASCADE が無いため、子テーブル (tasks) を明示削除する
  // 既存の 2 段構成は維持する。
  const db = getDb();
  const owned = await db
    .select({ id: lists.id })
    .from(lists)
    .where(and(eq(lists.id, listId), eq(lists.user_id, userId)))
    .limit(1);
  if (owned.length === 0) return;
  await db.delete(tasks).where(eq(tasks.list_id, listId));
  await db.delete(lists).where(eq(lists.id, listId));
}

/** リストを archived にする。 */
export async function archiveList(
  userId: number,
  listId: number,
): Promise<void> {
  await getOwnedList(listId, userId);
  const db = getDb();
  await db
    .update(lists)
    .set({ status: "archived" })
    .where(eq(lists.id, listId));
}

/**
 * 2つのリストを統合する。
 *
 * source の全タスクを target に移動し、source リストを削除する。
 * 並び順は各リスト内の sort_order を維持しつつ、updated でインターリーブする。
 * sort_order と updated が矛盾する箇所は線形補間で補正する。
 */
export async function mergeLists(
  userId: number,
  sourceListId: number,
  targetListId: number,
): Promise<void> {
  if (sourceListId === targetListId) {
    throw new Error("same_list");
  }
  const sourceList = await getOwnedList(sourceListId, userId);
  const targetList = await getOwnedList(targetListId, userId);
  if (sourceList.status !== "active" || targetList.status !== "active") {
    throw new Error("list_not_active");
  }

  const db = getDb();
  // 両リストの全タスクを sort_order 昇順で取得
  const [sourceTasks, targetTasks] = await Promise.all([
    db
      .select()
      .from(tasks)
      .where(eq(tasks.list_id, sourceListId))
      .orderBy(asc(tasks.sort_order)),
    db
      .select()
      .from(tasks)
      .where(eq(tasks.list_id, targetListId))
      .orderBy(asc(tasks.sort_order)),
  ]);

  // 各リストの updated を sort_order と整合するよう線形補間で補正
  const sourceAdjusted = adjustUpdatedTimestamps(sourceTasks);
  const targetAdjusted = adjustUpdatedTimestamps(targetTasks);

  // マージソートのマージステップで統合（adjusted 降順）
  const merged = mergeByTimestamp(
    targetTasks.map((t, i) => ({ task: t, adjusted: targetAdjusted[i] })),
    sourceTasks.map((t, i) => ({ task: t, adjusted: sourceAdjusted[i] })),
  );

  // sort_order を 0, 1000, 2000... で再割り当てし、一括更新
  for (let i = 0; i < merged.length; i++) {
    const { task, adjusted } = merged[i];
    const newSortOrder = i * 1000;
    const isSource = task.list_id === sourceListId;
    await db
      .update(tasks)
      .set({
        list_id: targetListId,
        sort_order: newSortOrder,
        // 補正された updated のみ DB に反映
        ...(adjusted !== task.updated.getTime() && {
          updated: new Date(adjusted),
        }),
      })
      .where(eq(tasks.id, task.id));
    // target のタスクも sort_order が変わる場合がある
    if (!isSource && newSortOrder !== task.sort_order) {
      // 上の update で既に更新済み
    }
  }

  // source リストを削除
  await db.delete(lists).where(eq(lists.id, sourceListId));
  // target の last_updated を更新
  await touchListUpdated(targetListId);
}

/** リストを active に戻す。 */
export async function unarchiveList(
  userId: number,
  listId: number,
): Promise<void> {
  await getOwnedList(listId, userId);
  const db = getDb();
  await db.update(lists).set({ status: "active" }).where(eq(lists.id, listId));
}

// ── タスク操作 ──

/** タスクを追加する。sort_order は既存の最小値 - 1000（先頭追加）。 */
export async function postTask(
  userId: number,
  listId: number,
  text: string,
): Promise<void> {
  await getOwnedList(listId, userId);
  const cleanText = text.trimEnd();
  const db = getDb();
  const now = new Date();
  // 現在の最小 sort_order を取得
  const [{ minOrder }] = await db
    .select({ minOrder: min(tasks.sort_order) })
    .from(tasks)
    .where(eq(tasks.list_id, listId));
  const sortOrder = (minOrder ?? 1000) - 1000;
  await db.insert(tasks).values({
    list_id: listId,
    status: "active",
    text: cleanText,
    sort_order: sortOrder,
    created: now,
    updated: now,
  });
  await touchListUpdated(listId);
}

/**
 * タスクを更新する（部分更新）。
 *
 * data のキーに応じて以下の更新パターンを処理する:
 * - text: テキスト変更 + keep_order=false なら先頭移動
 * - status: ステータス変更（active→completed 時に completed 日時を自動セット）
 * - completed: 完了日時の明示的な上書き（null でクリア）
 * - move_to: 別リストへの移動（移動先リストの先頭に配置）
 *
 * 各パターンは同時に適用可能（例: テキスト変更 + リスト移動）。
 */
export async function patchTask(
  userId: number,
  listId: number,
  taskId: number,
  data: Record<string, unknown>,
): Promise<TaskPatchResult> {
  await getOwnedList(listId, userId);

  const db = getDb();
  const taskRows = await db
    .select()
    .from(tasks)
    .where(and(eq(tasks.id, taskId), eq(tasks.list_id, listId)))
    .limit(1);
  if (taskRows.length === 0) throw new Error("task_not_found");
  const task = taskRows[0];

  const updates: Record<string, unknown> = {};

  if ("text" in data) {
    updates.text = (data.text as string).trimEnd();
    // keep_order=true の場合は sort_order を維持、false の場合は先頭に移動
    if (!data.keep_order) {
      const [{ minOrder }] = await db
        .select({ minOrder: min(tasks.sort_order) })
        .from(tasks)
        .where(eq(tasks.list_id, listId));
      const currentMin = minOrder ?? task.sort_order;
      if (task.sort_order > currentMin) {
        updates.sort_order = currentMin - 1000;
      }
    }
    updates.updated = new Date();
  }
  if ("status" in data) {
    const newStatus = data.status as string;
    if (task.status === "active" && newStatus === "completed") {
      updates.completed = new Date();
    }
    updates.status = newStatus;
  }
  if ("completed" in data) {
    updates.completed =
      data.completed === null ? null : fromUtcIso(data.completed as string);
  }

  let targetListId = listId;
  if ("move_to" in data) {
    const moveTo = Number(data.move_to);
    if (moveTo !== listId) {
      await getOwnedList(moveTo, userId);
      updates.list_id = moveTo;
      targetListId = moveTo;
      // 移動先リストの先頭に配置
      const [{ minOrder }] = await db
        .select({ minOrder: min(tasks.sort_order) })
        .from(tasks)
        .where(eq(tasks.list_id, moveTo));
      updates.sort_order = (minOrder ?? 1000) - 1000;
      await touchListUpdated(moveTo);
    }
  }

  if (Object.keys(updates).length > 0) {
    await db.update(tasks).set(updates).where(eq(tasks.id, taskId));
  }
  await touchListUpdated(listId);

  // 更新後のタスクを再取得
  const updated = (
    await db.select().from(tasks).where(eq(tasks.id, taskId)).limit(1)
  )[0];
  return {
    status: updated.status,
    completed: updated.completed ? toUtcIso(updated.completed) : null,
    list_id: targetListId,
    title: splitTitle(updated.text),
    notes: splitNotes(updated.text),
  };
}

/** 全リスト横断でタスクを LIKE 検索する */
export async function searchTasks(
  userId: number,
  query: string,
): Promise<SearchTaskResult[]> {
  const db = getDb();
  // ユーザーの active リストを取得
  const userLists = await db
    .select()
    .from(lists)
    .where(and(eq(lists.user_id, userId), eq(lists.status, "active")));
  if (userLists.length === 0) return [];

  // LIKE 用にワイルドカードをエスケープ
  const escaped = query.replace(/[%_]/g, "\\$&");
  const pattern = `%${escaped}%`;

  const listIds = userLists.map((l) => l.id);
  const rows = await db
    .select()
    .from(tasks)
    .where(and(inArray(tasks.list_id, listIds), like(tasks.text, pattern)))
    .orderBy(asc(tasks.sort_order));

  // listId → title のマップ
  const listMap = new Map(userLists.map((l) => [l.id, l.title]));
  return rows
    .filter((t) => t.status !== "archived")
    .map((t) => ({
      id: t.id,
      title: splitTitle(t.text),
      notes: splitNotes(t.text),
      status: t.status,
      listId: t.list_id,
      listTitle: listMap.get(t.list_id) ?? "",
    }));
}

/** タスクの並び順を更新する */
export async function reorderTasks(
  userId: number,
  listId: number,
  taskIds: number[],
): Promise<void> {
  await getOwnedList(listId, userId);
  const db = getDb();
  // taskIds の順に sort_order を 0, 1000, 2000... で再割当
  for (let i = 0; i < taskIds.length; i++) {
    await db
      .update(tasks)
      .set({ sort_order: i * 1000 })
      .where(and(eq(tasks.id, taskIds[i]), eq(tasks.list_id, listId)));
  }
  await touchListUpdated(listId);
}

/** タイマーの並び順を更新する（全件一致を検証） */
export async function reorderTimers(
  userId: number,
  timerIds: number[],
): Promise<void> {
  const db = getDb();
  // ユーザーの全タイマーIDを取得して全件一致を検証
  const owned = await db
    .select({ id: timers.id })
    .from(timers)
    .where(eq(timers.user_id, userId));
  const ownedIds = new Set(owned.map((r) => r.id));
  if (
    timerIds.length !== ownedIds.size ||
    !timerIds.every((id) => ownedIds.has(id))
  ) {
    throw new Error("invalid_timer_ids");
  }
  // timerIds の順に sort_order を 0, 1000, 2000... で再割当
  for (let i = 0; i < timerIds.length; i++) {
    await db
      .update(timers)
      .set({ sort_order: i * 1000 })
      .where(and(eq(timers.id, timerIds[i]), eq(timers.user_id, userId)));
  }
}

// ── タイマー操作 ──

/** タイマーの所有権チェック */
async function getOwnedTimer(timerId: number, userId: number) {
  const db = getDb();
  const rows = await db
    .select()
    .from(timers)
    .where(and(eq(timers.id, timerId), eq(timers.user_id, userId)))
    .limit(1);
  if (rows.length === 0) throw new Error("not_found_or_forbidden");
  return rows[0];
}

/**
 * running 中のタイマーが 0 以下なら自動停止する。
 * 全クライアントが閉じていても DB の正しさを保証する。
 */
async function autoStopIfExpired(
  timer: typeof timers.$inferSelect,
): Promise<typeof timers.$inferSelect> {
  if (!timer.running || !timer.started_at) return timer;
  const elapsed = Math.floor((Date.now() - timer.started_at.getTime()) / 1000);
  const remaining = timer.remaining_seconds - elapsed;
  if (remaining > 0) return timer;
  // 期限切れ → 自動停止
  const db = getDb();
  await db
    .update(timers)
    .set({
      running: 0,
      expired: 1,
      remaining_seconds: 0,
      started_at: null,
      updated: new Date(),
    })
    .where(eq(timers.id, timer.id));
  return {
    ...timer,
    running: 0,
    expired: 1,
    remaining_seconds: 0,
    started_at: null,
  };
}

/** DB の timer 行を TimerInfo に変換する */
function toTimerInfo(row: typeof timers.$inferSelect): TimerInfo {
  return {
    id: row.id,
    name: row.name,
    mode: row.mode as "countdown" | "alarm",
    target_minutes: row.target_minutes,
    base_seconds: row.base_seconds,
    adjust_minutes: row.adjust_minutes,
    running: row.running === 1,
    expired: row.expired === 1,
    ephemeral: row.ephemeral === 1,
    remaining_seconds: row.remaining_seconds,
    started_at: row.started_at ? toUtcIso(row.started_at) : null,
    sort_order: row.sort_order,
  };
}

/** target_minutes と tz_offset から remaining_seconds を計算する（サーバー側 UTC 基準） */
function calcAlarmRemainingSeconds(
  targetMinutes: number,
  tzOffsetMinutes: number,
): number {
  const nowUtcMs = Date.now();
  const nowLocal = new Date(nowUtcMs + tzOffsetMinutes * 60 * 1000);
  const nowLocalMinutes =
    nowLocal.getUTCHours() * 60 + nowLocal.getUTCMinutes();
  const nowLocalSeconds = nowLocal.getUTCSeconds();
  let diffMinutes = targetMinutes - nowLocalMinutes;
  if (diffMinutes < 0 || (diffMinutes === 0 && nowLocalSeconds > 0)) {
    diffMinutes += 24 * 60;
  }
  return diffMinutes * 60 - nowLocalSeconds;
}

/** タイマー一覧取得 + サーバー時刻返却 */
export async function getTimers(
  userId: number,
): Promise<{ timers: TimerInfo[]; server_time: string }> {
  const db = getDb();
  const rows = await db
    .select()
    .from(timers)
    .where(eq(timers.user_id, userId))
    .orderBy(timers.sort_order, timers.created);
  // 期限切れタイマーを自動停止
  const processed = await Promise.all(rows.map(autoStopIfExpired));
  return {
    timers: processed.map(toTimerInfo),
    server_time: new Date().toISOString(),
  };
}

/** タイマーを作成する（sort_order は既存の最大値 + 1000 で末尾追加） */
export async function createTimer(
  userId: number,
  name: string,
  baseSeconds: number,
  adjustMinutes: number,
  mode: string = "countdown",
  targetMinutes: number | null = null,
  tzOffsetMinutes: number | null = null,
  ephemeral: boolean = false,
): Promise<void> {
  if (mode === "alarm") {
    if (targetMinutes === null || tzOffsetMinutes === null)
      throw new Error("alarm_missing_params");
  }
  const isAlarm = mode === "alarm";
  const remainingSeconds = isAlarm
    ? calcAlarmRemainingSeconds(targetMinutes!, tzOffsetMinutes!)
    : baseSeconds;
  const db = getDb();
  const now = new Date();
  // 現在の最大 sort_order を取得
  const [{ maxOrder }] = await db
    .select({ maxOrder: max(timers.sort_order) })
    .from(timers)
    .where(eq(timers.user_id, userId));
  const sortOrder = (maxOrder ?? 0) + 1000;
  await db.insert(timers).values({
    user_id: userId,
    name,
    mode,
    base_seconds: isAlarm ? 0 : baseSeconds,
    adjust_minutes: adjustMinutes,
    remaining_seconds: remainingSeconds,
    target_minutes: targetMinutes,
    running: isAlarm ? 1 : 0,
    ephemeral: ephemeral ? 1 : 0,
    started_at: isAlarm ? now : null,
    sort_order: sortOrder,
    created: now,
    updated: now,
  });
}

/** タイマー設定を変更する */
export async function updateTimer(
  userId: number,
  timerId: number,
  data: {
    name?: string;
    mode?: string;
    base_seconds?: number;
    target_minutes?: number;
    tz_offset_minutes?: number;
    adjust_minutes?: number;
  },
): Promise<void> {
  const timer = await getOwnedTimer(timerId, userId);
  const db = getDb();
  const updates: Record<string, unknown> = { updated: new Date() };
  if (data.name !== undefined) updates.name = data.name;
  if (data.adjust_minutes !== undefined)
    updates.adjust_minutes = data.adjust_minutes;

  // モード変更処理
  if (data.mode !== undefined && data.mode !== timer.mode) {
    if (timer.running) throw new Error("timer_is_running");
    updates.mode = data.mode;
    updates.expired = 0;
    if (data.mode === "alarm") {
      if (
        data.target_minutes === undefined ||
        data.tz_offset_minutes === undefined
      )
        throw new Error("alarm_missing_params");
      updates.target_minutes = data.target_minutes;
      updates.base_seconds = 0;
      updates.remaining_seconds = calcAlarmRemainingSeconds(
        data.target_minutes,
        data.tz_offset_minutes,
      );
    } else {
      // alarm → countdown
      if (data.base_seconds === undefined)
        throw new Error("countdown_missing_base_seconds");
      updates.base_seconds = data.base_seconds;
      updates.target_minutes = null;
      updates.remaining_seconds = data.base_seconds;
    }
  } else {
    // モード変更なしの場合
    if (data.base_seconds !== undefined)
      updates.base_seconds = data.base_seconds;
    if (data.target_minutes !== undefined) {
      updates.target_minutes = data.target_minutes;
      // アラームモードで target_minutes を変更した場合は remaining_seconds も再計算
      if (
        (data.mode ?? timer.mode) === "alarm" &&
        data.tz_offset_minutes !== undefined
      ) {
        updates.remaining_seconds = calcAlarmRemainingSeconds(
          data.target_minutes,
          data.tz_offset_minutes,
        );
      }
    }
  }

  await db.update(timers).set(updates).where(eq(timers.id, timerId));
}

/** タイマーを削除する */
export async function deleteTimer(
  userId: number,
  timerId: number,
): Promise<void> {
  // 冪等な削除: 対象が無い・他ユーザーのものは no-op (NOT_FOUND を返さない)。
  // 別端末で先に削除されていた場合のレース時に、こちらの削除がエラーにならず
  // クライアントの状態を確実に整合させるため。
  const db = getDb();
  await db
    .delete(timers)
    .where(and(eq(timers.id, timerId), eq(timers.user_id, userId)));
}

/** タイマーを開始する */
export async function startTimer(
  userId: number,
  timerId: number,
  tzOffsetMinutes?: number,
): Promise<void> {
  const timer = await getOwnedTimer(timerId, userId);
  if (timer.running) return;
  const now = new Date();
  const db = getDb();

  if (timer.mode === "alarm") {
    if (timer.target_minutes === null || tzOffsetMinutes === undefined)
      throw new Error("alarm_missing_params");
    const remaining = calcAlarmRemainingSeconds(
      timer.target_minutes,
      tzOffsetMinutes,
    );
    if (remaining <= 0) return;
    await db
      .update(timers)
      .set({
        running: 1,
        expired: 0,
        remaining_seconds: remaining,
        started_at: now,
        updated: now,
      })
      .where(eq(timers.id, timerId));
  } else {
    if (timer.remaining_seconds <= 0) return;
    await db
      .update(timers)
      .set({ running: 1, expired: 0, started_at: now, updated: now })
      .where(eq(timers.id, timerId));
  }
}

/** タイマーを一時停止する */
export async function pauseTimer(
  userId: number,
  timerId: number,
): Promise<void> {
  const timer = await getOwnedTimer(timerId, userId);
  if (!timer.running || !timer.started_at) return;
  const elapsed = Math.floor((Date.now() - timer.started_at.getTime()) / 1000);
  const remaining = Math.max(0, timer.remaining_seconds - elapsed);
  const db = getDb();
  await db
    .update(timers)
    .set({
      running: 0,
      expired: remaining === 0 ? 1 : 0,
      remaining_seconds: remaining,
      started_at: null,
      updated: new Date(),
    })
    .where(eq(timers.id, timerId));
}

/**
 * タイマーをリセットする（トグル動作）。
 * - カウントダウン: running中 or 途中使用中 → base_seconds に戻す / base_seconds と一致 → 0 にクリア
 * - アラーム: 次のターゲット時刻までの秒数をサーバー側で再計算
 */
export async function resetTimer(
  userId: number,
  timerId: number,
  tzOffsetMinutes?: number,
): Promise<void> {
  const timer = await getOwnedTimer(timerId, userId);
  let newRemaining: number;

  if (timer.mode === "alarm") {
    if (timer.target_minutes === null || tzOffsetMinutes === undefined)
      throw new Error("alarm_missing_params");
    newRemaining = calcAlarmRemainingSeconds(
      timer.target_minutes,
      tzOffsetMinutes,
    );
  } else {
    let currentRemaining = timer.remaining_seconds;
    if (timer.running && timer.started_at) {
      const elapsed = Math.floor(
        (Date.now() - timer.started_at.getTime()) / 1000,
      );
      currentRemaining = Math.max(0, timer.remaining_seconds - elapsed);
    }
    // トグルロジック: base_seconds と一致 → 0、それ以外 → base_seconds
    newRemaining =
      !timer.running && currentRemaining === timer.base_seconds
        ? 0
        : timer.base_seconds;
  }

  const db = getDb();
  await db
    .update(timers)
    .set({
      running: 0,
      expired: 0,
      remaining_seconds: newRemaining,
      started_at: null,
      updated: new Date(),
    })
    .where(eq(timers.id, timerId));
}

/** タイマーの残り時間を延長/削減する */
export async function adjustTimer(
  userId: number,
  timerId: number,
  minutes: number,
): Promise<void> {
  const timer = await getOwnedTimer(timerId, userId);
  let currentRemaining = timer.remaining_seconds;
  // running 中は経過時間を考慮
  if (timer.running && timer.started_at) {
    const elapsed = Math.floor(
      (Date.now() - timer.started_at.getTime()) / 1000,
    );
    currentRemaining -= elapsed;
  }
  const newRemaining = Math.max(0, currentRemaining + minutes * 60);
  // アラームモード: target_minutes も連動して更新
  const targetMinutesUpdate =
    timer.mode === "alarm" && timer.target_minutes !== null
      ? (((timer.target_minutes + minutes) % 1440) + 1440) % 1440
      : undefined;
  const db = getDb();
  if (timer.running && timer.started_at) {
    // running 中: started_at を現在時刻にリセットし、remaining_seconds を新しい値に
    const runningUpdates: Record<string, unknown> = {
      remaining_seconds: newRemaining,
      started_at: newRemaining > 0 ? new Date() : null,
      running: newRemaining > 0 ? 1 : 0,
      expired: 0,
      updated: new Date(),
    };
    if (targetMinutesUpdate !== undefined)
      runningUpdates.target_minutes = targetMinutesUpdate;
    await db.update(timers).set(runningUpdates).where(eq(timers.id, timerId));
  } else {
    const stoppedUpdates: Record<string, unknown> = {
      remaining_seconds: newRemaining,
      expired: 0,
      updated: new Date(),
    };
    if (targetMinutesUpdate !== undefined)
      stoppedUpdates.target_minutes = targetMinutesUpdate;
    await db.update(timers).set(stoppedUpdates).where(eq(timers.id, timerId));
  }
}

/**
 * タイマーを停止する（0秒到達時）。
 * startedAt が指定された場合、タイマーがリセット/再開されていないことを確認する。
 * これにより、遅延した stop リクエストが新しいセッションを上書きするのを防ぐ。
 */
export async function stopTimer(
  userId: number,
  timerId: number,
  startedAt?: string | null,
): Promise<void> {
  const timer = await getOwnedTimer(timerId, userId);
  // started_at が指定された場合、タイマーがリセット/再開されていないことを確認
  if (startedAt !== undefined) {
    const currentStartedAt = timer.started_at
      ? timer.started_at.toISOString()
      : null;
    if (currentStartedAt !== startedAt) return;
  }
  if (!timer.running) return;
  const db = getDb();
  await db
    .update(timers)
    .set({
      running: 0,
      expired: 1,
      remaining_seconds: 0,
      started_at: null,
      updated: new Date(),
    })
    .where(eq(timers.id, timerId));
}

/** タイマーの残り時間を直接設定する（停止中のみ） */
export async function setTimerTime(
  userId: number,
  timerId: number,
  seconds: number,
  targetMinutes?: number,
  tzOffsetMinutes?: number,
): Promise<void> {
  const timer = await getOwnedTimer(timerId, userId);
  if (timer.running) throw new Error("timer_is_running");
  const db = getDb();
  const updates: Record<string, unknown> = { expired: 0, updated: new Date() };
  if (targetMinutes !== undefined && timer.mode === "alarm") {
    updates.target_minutes = targetMinutes;
    if (tzOffsetMinutes !== undefined) {
      updates.remaining_seconds = calcAlarmRemainingSeconds(
        targetMinutes,
        tzOffsetMinutes,
      );
    } else {
      updates.remaining_seconds = seconds;
    }
  } else {
    updates.remaining_seconds = seconds;
  }
  await db.update(timers).set(updates).where(eq(timers.id, timerId));
}
