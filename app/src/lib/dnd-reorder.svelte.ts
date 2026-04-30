/**
 * @fileoverview D&D による並び替えロジック共通ユーティリティ（Svelte 5 rune ベース）
 *
 * Pointer Events API で実装し、マウス・タッチ・ペンを単一コードパスで扱う。
 * TaskList および TimerCard 一覧で重複していた D&D 状態管理と操作関数をここに集約する。
 *
 * 呼び出し側コンポーネントの規約:
 *
 * - 並び替え対象の各行ルート要素には `data-reorder-id={id}` を付与する（hit-testing に使う）。
 * - ドラッグハンドル要素には `onpointerdown` を設定し、CSS で `touch-action: none` を適用する
 *   （タッチ操作で縦スクロールにハイジャックされるのを防ぐため）。
 */

/**
 * D&D 並び替えに必要な最小共通インターフェース。
 * 並び替え対象アイテムはこのインターフェースを満たせばよい。
 */
export interface Orderable {
  id: number;
}

/** `createDragReorder` の挙動をカスタマイズするオプション。 */
export interface DragReorderOptions {
  /**
   * ドラッグ判定の閾値（px）。
   * 開始位置からこの距離を超えたら `isActive=true` となり視覚フィードバックが反映される。
   * タッチ操作の微小な揺れによる誤発火を抑制するため、既定 5px とする。
   */
  threshold?: number;
  /**
   * hit-testing で対象アイテムを解決するための CSS セレクタ。
   * 既定は `[data-reorder-id]`。
   */
  itemSelector?: string;
  /**
   * hit-testing で読み取る `dataset` キー（`data-*` のキャメルケース表記）。
   * 既定は `reorderId`（=`data-reorder-id`）。
   */
  itemIdAttribute?: string;
}

/**
 * D&D 並び替えユーティリティを生成する。
 *
 * @param getItems - 現在の並び順でアイテム一覧を返すゲッター関数。
 *   Svelte の reactivity（`$derived` など）と組み合わせる場合は、
 *   呼び出し側が `() => derivedValue` として渡す。
 * @param onReorder - ドロップ完了時に新しい id 配列を受け取るコールバック。
 * @param options - 任意のオプション設定。
 */
export function createDragReorder<T extends Orderable>(
  getItems: () => T[],
  onReorder: (ids: number[]) => void,
  options?: DragReorderOptions,
) {
  const threshold = options?.threshold ?? 5;
  const itemSelector = options?.itemSelector ?? "[data-reorder-id]";
  const itemIdAttribute = options?.itemIdAttribute ?? "reorderId";

  // D&D 状態（Svelte 5 $state rune）
  let draggedId = $state<number | null>(null);
  let isActive = $state(false);
  let dropTargetId = $state<number | null>(null);
  let dropPosition = $state<"before" | "after" | null>(null);

  // 内部状態（reactivity 不要のため通常変数）
  let startX = 0;
  let startY = 0;
  let activePointerId: number | null = null;
  let captureElement: Element | null = null;

  /**
   * pointerdown ハンドラ。
   * pointer capture を取得し、window へ pointermove / pointerup / pointercancel を登録する。
   * これにより指やマウスがハンドル要素から離れても以降のイベントを受け取れる。
   */
  function handleDragStart(itemId: number, event: PointerEvent) {
    draggedId = itemId;
    isActive = false;
    dropTargetId = null;
    dropPosition = null;
    startX = event.clientX;
    startY = event.clientY;
    activePointerId = event.pointerId;
    captureElement = event.currentTarget as Element | null;

    // setPointerCapture が失敗してもドラッグ自体は継続させる
    // （happy-dom など一部環境では NotFoundError を送出することがあるため）
    try {
      captureElement?.setPointerCapture(event.pointerId);
    } catch {
      // 環境依存の失敗は無視する
    }

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    captureElement?.addEventListener(
      "lostpointercapture",
      handleLostPointerCapture,
    );
  }

  /**
   * pointermove ハンドラ。
   * 閾値超過で isActive を立て、座標から hit-testing で対象アイテムと before/after を判定する。
   */
  function handlePointerMove(event: PointerEvent) {
    if (draggedId === null) return;
    if (activePointerId !== null && event.pointerId !== activePointerId) return;

    if (!isActive) {
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (dx * dx + dy * dy < threshold * threshold) return;
      isActive = true;
    }

    const target = findReorderTarget(event.clientX, event.clientY);
    if (target === null || target.id === draggedId) {
      dropTargetId = null;
      dropPosition = null;
      return;
    }
    const rect = target.element.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    dropTargetId = target.id;
    dropPosition = event.clientY < midY ? "before" : "after";
  }

  /**
   * 座標 (x, y) から並び替え対象のアイテムを解決する。
   * `document.elementFromPoint` で取得した要素から
   * `closest(itemSelector)` で行ルートへ遡り、data 属性から id を読み取る。
   */
  function findReorderTarget(
    x: number,
    y: number,
  ): { id: number; element: HTMLElement } | null {
    const hit = document.elementFromPoint(x, y);
    if (!(hit instanceof Element)) return null;
    const row = hit.closest<HTMLElement>(itemSelector);
    if (!row) return null;
    const idStr = row.dataset[itemIdAttribute];
    if (idStr === undefined) return null;
    const id = Number(idStr);
    if (!Number.isFinite(id)) return null;
    return { id, element: row };
  }

  /**
   * pointerup ハンドラ。
   * 閾値を超えていればドロップを確定し、超えていなければ状態のみリセットする。
   */
  function handlePointerUp(event: PointerEvent) {
    if (activePointerId !== null && event.pointerId !== activePointerId) return;
    cleanupPointerListeners();
    if (isActive) {
      handleDrop();
    } else {
      resetDragState();
    }
  }

  /** pointercancel ハンドラ。状態をリセットして終了する。 */
  function handlePointerCancel(event: PointerEvent) {
    if (activePointerId !== null && event.pointerId !== activePointerId) return;
    cleanupPointerListeners();
    resetDragState();
  }

  /**
   * lostpointercapture ハンドラ。
   * OS のジェスチャ介入などで pointer capture を奪われた際にも状態を確実にリセットする。
   */
  function handleLostPointerCapture() {
    cleanupPointerListeners();
    resetDragState();
  }

  /** window へ登録した pointer 系リスナーを撤去する。 */
  function cleanupPointerListeners() {
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUp);
    window.removeEventListener("pointercancel", handlePointerCancel);
    captureElement?.removeEventListener(
      "lostpointercapture",
      handleLostPointerCapture,
    );
    captureElement = null;
    activePointerId = null;
  }

  /**
   * ドロップ確定時に呼ぶ。新しい id 順を構成して `onReorder` に渡す。
   * `pointerup` 時に内部から呼ばれるが、テスト互換のため公開する。
   */
  function handleDrop() {
    if (draggedId === null || dropTargetId === null) {
      resetDragState();
      return;
    }
    const ids = getItems()
      .map((t) => t.id)
      .filter((id) => id !== draggedId);
    const targetIndex = ids.indexOf(dropTargetId);
    if (targetIndex === -1) {
      resetDragState();
      return;
    }
    const insertIndex =
      dropPosition === "after" ? targetIndex + 1 : targetIndex;
    ids.splice(insertIndex, 0, draggedId);
    onReorder(ids);
    resetDragState();
  }

  /**
   * `currentTarget` の境界矩形を基準に before/after を判定するレガシー API。
   * 新コードでは Pointer Events 経由の hit-testing で代替されるが、
   * 既存ユニットテストの互換性維持と、特定要素を対象に直接判定したいケースのために残す。
   */
  function handleDragOver(itemId: number, event: PointerEvent) {
    if (draggedId === null || itemId === draggedId) return;
    isActive = true;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    dropTargetId = itemId;
    dropPosition = event.clientY < midY ? "before" : "after";
  }

  /** ドラッグ終了・キャンセル時の状態リセット。 */
  function resetDragState() {
    draggedId = null;
    isActive = false;
    dropTargetId = null;
    dropPosition = null;
  }

  return {
    /** 現在ドラッグ中のアイテム id（pointerdown 時点で確定）。 */
    get draggedId() {
      return draggedId;
    },
    /** 閾値超過後の「実ドラッグ中」状態（視覚フィードバック制御に使う）。 */
    get isActive() {
      return isActive;
    },
    /** 現在のドロップ候補アイテム id。 */
    get dropTargetId() {
      return dropTargetId;
    },
    /** ドロップ位置（before / after）。 */
    get dropPosition() {
      return dropPosition;
    },
    handleDragStart,
    handleDragOver,
    handleDrop,
    resetDragState,
  };
}
