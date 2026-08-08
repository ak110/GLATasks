/**
 * @fileoverview 全アクティブタスクキャッシュとサーバー応答のマージユーティリティ
 */

import type { GetActiveTasksResult, TaskListItem } from "./types";

/** 全アクティブタスクキャッシュ */
export type ActiveTasksCache = {
  tasks: TaskListItem[];
  serverTime: string;
};

/**
 * サーバー応答をキャッシュにマージして新しいキャッシュを返す純関数。
 *
 * prev が undefined（初回取得時）は mode に関わらず応答タスクをそのまま採用する。
 * delta モードでは id 単位の upsert を行う。
 */
export function mergeActiveTasks(
  prev: ActiveTasksCache | undefined,
  response: GetActiveTasksResult,
): ActiveTasksCache {
  if (!prev || response.mode === "full") {
    return {
      tasks: response.tasks,
      serverTime: response.serverTime,
    };
  }

  // delta モード: upsert
  const responseMap = new Map(response.tasks.map((t) => [t.id, t]));
  const prevIds = new Set(prev.tasks.map((t) => t.id));

  // 既存タスクは応答にあれば応答値で更新、無ければそのまま維持。
  // _key は prev 側の値を保持する。楽観追加タスクは onSuccess で id だけ実IDに
  // 差し替え _key は仮IDのまま残るため、ここで応答の _key（実ID）に置き換えると
  // Svelte の {#each} keying が変化してコンポーネントが再生成され、開いていた
  // メニュー等の $state が初期化される。
  const merged = prev.tasks.map((t) => {
    const updated = responseMap.get(t.id);
    return updated ? { ...updated, _key: t._key } : t;
  });

  // 応答にしか含まれない新規タスクを末尾に追加
  for (const t of response.tasks) {
    if (!prevIds.has(t.id)) {
      merged.push(t);
    }
  }

  return { tasks: merged, serverTime: response.serverTime };
}

/**
 * タスク配列を sort_order 昇順（同値は id 昇順）で並べ替えて返す純関数。
 *
 * リスト単位フィルタ後にこの関数で並べることで決定論的な表示順を保証する。
 */
export function sortByListAndOrder(tasks: TaskListItem[]): TaskListItem[] {
  return [...tasks].sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.id - b.id;
  });
}

/**
 * タスク配列を listId と showType で抽出する。
 */
export function filterByList(
  tasks: TaskListItem[],
  listId: number,
  showType: "active" | "archived" | "all",
): TaskListItem[] {
  return tasks.filter((t) => {
    if (t.listId !== listId) return false;
    if (showType === "active") return t.status !== "archived";
    if (showType === "archived") return t.status === "archived";
    return true;
  });
}
