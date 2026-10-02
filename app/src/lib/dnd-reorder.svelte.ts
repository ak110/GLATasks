/**
 * @fileoverview D&D による並び替えロジック共通ユーティリティ（Svelte 5 rune ベース）
 *
 * Pointer Events API で実装し、マウス・タッチ・ペンを単一コードパスで扱う。
 *
 * 呼び出し側コンポーネントの規約:
 *
 * - 並び替え対象の各行ルート要素には `data-reorder-id={id}` を付与する（hit-testing に使う）。
 * - 並び替え対象から外す行には `data-reorder-id` を付与しない（位置指定の基準から除外される）。
 * - ドラッグハンドル要素には `onpointerdown` を設定し、CSS で `touch-action: none` を適用する
 *   （タッチ操作で縦スクロールにハイジャックされるのを防ぐため）。
 * - 並び替え対象の行は縦スクロール要素（`overflow-y: auto | scroll`）の内側に置く。
 *   ドラッグ中はハンドルから最も近い縦スクロール要素を自動スクロールの対象とし、
 *   ポインターがその上端・下端付近にある間スクロールする（`touch-action: none` で止めた
 *   指によるスクロールの代わりに、表示範囲外の位置へ1回のドラッグで到達させるため）。
 */

/** 自動スクロールを開始する端からの距離（px）。要素の高さの1/4を上限とする。 */
const AUTO_SCROLL_EDGE = 48;
/** 自動スクロールの1フレームあたりの最大移動量（px）。 */
const AUTO_SCROLL_MAX_SPEED = 16;

/** 要素から祖先へ遡り、最も近い縦方向のスクロール要素を返す。 */
function findScrollContainer(start: Element | null): HTMLElement | null {
  let el: Element | null = start;
  while (el && el !== document.body && el !== document.documentElement) {
    if (el instanceof HTMLElement) {
      const overflowY = getComputedStyle(el).overflowY;
      if (overflowY === "auto" || overflowY === "scroll") return el;
    }
    el = el.parentElement;
  }
  return null;
}

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
  /**
   * 並び替え対象とは別のドロップ先を解決する CSS セレクタ。
   * 指定した場合は Pointer Events の同じ状態遷移で外部ドロップを扱う。
   */
  externalDropTargetSelector?: string;
  /** 外部ドロップ先の id を読み取る `dataset` キー。 */
  externalDropTargetIdAttribute?: string;
  /** 外部ドロップ先候補が変化したときに呼ぶコールバック。 */
  onExternalDropTargetChange?: (targetId: number | null) => void;
  /** 外部ドロップを確定したときに呼ぶコールバック。 */
  onExternalDrop?: (draggedId: number, targetId: number) => void;
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
  const externalDropTargetSelector = options?.externalDropTargetSelector;
  const externalDropTargetIdAttribute =
    options?.externalDropTargetIdAttribute ?? "dropTargetId";

  // D&D 状態（Svelte 5 $state rune）
  let draggedId = $state<number | null>(null);
  let isActive = $state(false);
  let dropTargetId = $state<number | null>(null);
  let dropPosition = $state<"before" | "after" | null>(null);
  let externalDropTargetId = $state<number | null>(null);

  // 内部状態（reactivity 不要のため通常変数）
  let startX = 0;
  let startY = 0;
  let activePointerId: number | null = null;
  let captureElement: Element | null = null;
  // 自動スクロールの状態
  let scrollContainer: HTMLElement | null = null;
  let lastX = 0;
  let lastY = 0;
  let autoScrollFrame: number | null = null;

  /**
   * pointerdown ハンドラ。
   * pointer capture を取得し、window へ pointermove / pointerup / pointercancel を登録する。
   * これにより指やマウスがハンドル要素から離れても以降のイベントを受け取れる。
   */
  function handleDragStart(itemId: number, event: PointerEvent) {
    draggedId = itemId;
    updateDragState(false);
    dropTargetId = null;
    dropPosition = null;
    updateExternalDropTarget(null);
    startX = event.clientX;
    startY = event.clientY;
    activePointerId = event.pointerId;
    captureElement = event.currentTarget as Element | null;
    scrollContainer = findScrollContainer(captureElement);
    lastX = event.clientX;
    lastY = event.clientY;

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
   * 閾値超過で isActive を true にし、座標から hit-testing で対象アイテムと before/after を判定する。
   */
  function handlePointerMove(event: PointerEvent) {
    if (draggedId === null) return;
    if (activePointerId !== null && event.pointerId !== activePointerId) return;

    if (!isActive) {
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (dx * dx + dy * dy < threshold * threshold) return;
      updateDragState(true);
    }

    lastX = event.clientX;
    lastY = event.clientY;
    updateDropCandidates(event.clientX, event.clientY);
    scheduleAutoScroll();
  }

  /**
   * 座標から外部ドロップ先・並び替え対象・before/after を判定して候補を更新する。
   * pointermove と自動スクロールの各フレームで共有する（指を止めたまま一覧だけが
   * 動く間は pointermove が届かないため）。
   */
  function updateDropCandidates(x: number, y: number) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) {
      clearDropCandidates();
      return;
    }

    const externalTarget = findExternalDropTarget(x, y);
    if (externalTarget !== null) {
      dropTargetId = null;
      dropPosition = null;
      updateExternalDropTarget(externalTarget.id);
      return;
    }

    const target = findReorderTarget(x, y);
    if (target === null || target.id === draggedId) {
      clearDropCandidates();
      return;
    }
    updateExternalDropTarget(null);
    const rect = target.element.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    dropTargetId = target.id;
    dropPosition = y < midY ? "before" : "after";
  }

  /**
   * 現在のポインター位置に応じた1フレームあたりのスクロール量を返す（負は上方向）。
   * 横方向がスクロール要素の範囲外（2ペイン表示でサイドバーへドラッグ中など）は 0。
   */
  function autoScrollDelta(): number {
    if (!isActive || scrollContainer === null) return 0;
    if (!Number.isFinite(lastX) || !Number.isFinite(lastY)) return 0;
    const rect = scrollContainer.getBoundingClientRect();
    if (lastX < rect.left || lastX > rect.right) return 0;
    const edge = Math.min(AUTO_SCROLL_EDGE, rect.height / 4);
    if (edge <= 0) return 0;
    const maxScrollTop =
      scrollContainer.scrollHeight - scrollContainer.clientHeight;
    if (lastY < rect.top + edge && scrollContainer.scrollTop > 0) {
      const depth = Math.min(1, (rect.top + edge - lastY) / edge);
      return -Math.max(1, Math.round(AUTO_SCROLL_MAX_SPEED * depth));
    }
    if (
      lastY > rect.bottom - edge &&
      scrollContainer.scrollTop < maxScrollTop
    ) {
      const depth = Math.min(1, (lastY - (rect.bottom - edge)) / edge);
      return Math.max(1, Math.round(AUTO_SCROLL_MAX_SPEED * depth));
    }
    return 0;
  }

  /** 端の帯にいる間だけ requestAnimationFrame の反復を予約する。 */
  function scheduleAutoScroll() {
    if (autoScrollFrame !== null) return;
    if (autoScrollDelta() === 0) return;
    autoScrollFrame = requestAnimationFrame(runAutoScroll);
  }

  /** 1フレーム分スクロールし、スクロール後の位置でドロップ候補を再判定する。 */
  function runAutoScroll() {
    autoScrollFrame = null;
    const delta = autoScrollDelta();
    if (delta === 0 || scrollContainer === null) return;
    const before = scrollContainer.scrollTop;
    scrollContainer.scrollTop = before + delta;
    if (scrollContainer.scrollTop === before) return;
    updateDropCandidates(lastX, lastY);
    scheduleAutoScroll();
  }

  /** 予約済みの自動スクロールを取り消し、対象要素の参照を解放する。 */
  function stopAutoScroll() {
    if (autoScrollFrame !== null) {
      cancelAnimationFrame(autoScrollFrame);
      autoScrollFrame = null;
    }
    scrollContainer = null;
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

  /** 座標から外部ドロップ先を解決する。 */
  function findExternalDropTarget(
    x: number,
    y: number,
  ): { id: number; element: HTMLElement } | null {
    if (externalDropTargetSelector === undefined) return null;
    const hit = document.elementFromPoint(x, y);
    if (!(hit instanceof Element)) return null;
    const row = hit.closest<HTMLElement>(externalDropTargetSelector);
    if (!row) return null;
    const idStr = row.dataset[externalDropTargetIdAttribute];
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
    if (!isActive) {
      resetDragState();
      return;
    }

    const dragged = draggedId;
    const externalTarget = externalDropTargetId;
    if (dragged !== null && externalTarget !== null) {
      resetDragState();
      options?.onExternalDrop?.(dragged, externalTarget);
      return;
    }
    completeReorderDrop();
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
    stopAutoScroll();
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

  /** ドラッグ中に並び替え候補を確定し、新しい id 順を `onReorder` に渡す。 */
  function completeReorderDrop() {
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
    resetDragState();
    onReorder(ids);
  }

  /** 候補を排他的に消去する。 */
  function clearDropCandidates() {
    dropTargetId = null;
    dropPosition = null;
    updateExternalDropTarget(null);
  }

  /** 実ドラッグ状態を更新する。 */
  function updateDragState(nextIsActive: boolean) {
    isActive = nextIsActive;
  }

  /** 外部ドロップ先候補を更新し、表示側へ通知する。 */
  function updateExternalDropTarget(targetId: number | null) {
    if (externalDropTargetId === targetId) return;
    externalDropTargetId = targetId;
    options?.onExternalDropTargetChange?.(targetId);
  }

  /** ドラッグ終了・キャンセル時の状態リセット。 */
  function resetDragState() {
    draggedId = null;
    updateDragState(false);
    clearDropCandidates();
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
  };
}
