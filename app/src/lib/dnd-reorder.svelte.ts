/**
 * @fileoverview D&D による並び替えロジック共通ユーティリティ（Svelte 5 rune ベース）
 *
 * TaskList および TimerCard 一覧で完全に重複していた D&D 状態管理と
 * 4関数（DragStart / DragOver / Drop / reset）をここに集約する。
 */

/**
 * D&D 並び替えに必要な最小共通インターフェース。
 * 並び替え対象アイテムはこのインターフェースを満たせばよい。
 */
export interface Orderable {
  id: number;
}

/**
 * D&D 並び替えユーティリティを生成する。
 *
 * @param getItems - 現在の並び順でアイテム一覧を返すゲッター関数。
 *   Svelte の reactivity（$derived など）と組み合わせる場合は、
 *   呼び出し側が `() => derivedValue` として渡す。
 * @param onReorder - ドロップ完了時に新しい id 配列を受け取るコールバック。
 */
export function createDragReorder<T extends Orderable>(
  getItems: () => T[],
  onReorder: (ids: number[]) => void,
) {
  // D&D 状態（Svelte 5 $state rune）
  let draggedId = $state<number | null>(null);
  let dropTargetId = $state<number | null>(null);
  let dropPosition = $state<"before" | "after" | null>(null);

  /** ドラッグ開始 */
  function handleDragStart(itemId: number) {
    draggedId = itemId;
  }

  /**
   * ドラッグ中（カーソル位置で before / after を判定）。
   * 自分自身へのドラッグは無視する。
   */
  function handleDragOver(itemId: number, e: DragEvent) {
    if (draggedId === null || itemId === draggedId) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    dropTargetId = itemId;
    dropPosition = e.clientY < midY ? "before" : "after";
  }

  /** ドロップ: 新しい id 順を構成して onReorder に渡す */
  function handleDrop() {
    if (draggedId === null || dropTargetId === null) return;
    const ids = getItems()
      .map((t) => t.id)
      .filter((id) => id !== draggedId);
    const targetIndex = ids.indexOf(dropTargetId);
    if (targetIndex === -1) return;
    const insertIndex =
      dropPosition === "after" ? targetIndex + 1 : targetIndex;
    ids.splice(insertIndex, 0, draggedId);
    onReorder(ids);
    resetDragState();
  }

  /** ドラッグ終了・キャンセル時の状態リセット */
  function resetDragState() {
    draggedId = null;
    dropTargetId = null;
    dropPosition = null;
  }

  return {
    /** 現在ドラッグ中のアイテム id（ハイライト制御などに使用） */
    get draggedId() {
      return draggedId;
    },
    /** 現在のドロップ候補アイテム id */
    get dropTargetId() {
      return dropTargetId;
    },
    /** ドロップ位置（before / after） */
    get dropPosition() {
      return dropPosition;
    },
    handleDragStart,
    handleDragOver,
    handleDrop,
    resetDragState,
  };
}
