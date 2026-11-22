const AUTO_SCROLL_EDGE = 48;
const AUTO_SCROLL_MAX_SPEED = 16;

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

export interface Orderable {
  id: number;
}

export interface DragReorderOptions {
  threshold?: number;
  itemSelector?: string;
  itemIdAttribute?: string;
  externalDropTargetSelector?: string;
  externalDropTargetIdAttribute?: string;
  onExternalDropTargetChange?: (targetId: number | null) => void;
  onExternalDrop?: (draggedId: number, targetId: number) => void;
}

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

  type DragState =
    { phase: "idle" } | { phase: "pressed" | "dragging"; id: number };
  type DropTarget =
    | { kind: "none" }
    | { kind: "internal"; id: number; position: "before" | "after" }
    | { kind: "external"; id: number };
  let drag = $state<DragState>({ phase: "idle" });
  let target = $state<DropTarget>({ kind: "none" });
  const draggedId = $derived(drag.phase === "idle" ? null : drag.id);
  const isActive = $derived(drag.phase === "dragging");
  const dropTargetId = $derived(target.kind === "internal" ? target.id : null);
  const dropPosition = $derived(
    target.kind === "internal" ? target.position : null,
  );
  const externalDropTargetId = $derived(
    target.kind === "external" ? target.id : null,
  );

  let startX = 0;
  let startY = 0;
  let activePointerId: number | null = null;
  let captureElement: Element | null = null;
  let scrollContainer: HTMLElement | null = null;
  let lastX = 0;
  let lastY = 0;
  let autoScrollFrame: number | null = null;

  function handleDragStart(itemId: number, event: PointerEvent) {
    dispose();
    drag = { phase: "pressed", id: itemId };
    startX = event.clientX;
    startY = event.clientY;
    activePointerId = event.pointerId;
    captureElement = event.currentTarget as Element | null;
    scrollContainer = findScrollContainer(captureElement);
    lastX = event.clientX;
    lastY = event.clientY;

    try {
      captureElement?.setPointerCapture(event.pointerId);
    } catch {}

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    window.addEventListener("pointercancel", handlePointerCancel);
    captureElement?.addEventListener(
      "lostpointercapture",
      handleLostPointerCapture,
    );
  }

  function handlePointerMove(event: PointerEvent) {
    if (draggedId === null) return;
    if (activePointerId !== null && event.pointerId !== activePointerId) return;

    if (!isActive) {
      const dx = event.clientX - startX;
      const dy = event.clientY - startY;
      if (dx * dx + dy * dy < threshold * threshold) return;
      drag = { phase: "dragging", id: draggedId };
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

    const externalTarget = findDropTarget(
      x,
      y,
      externalDropTargetSelector,
      externalDropTargetIdAttribute,
    );
    if (externalTarget !== null) {
      updateTarget({ kind: "external", id: externalTarget.id });
      return;
    }

    const target = findDropTarget(x, y, itemSelector, itemIdAttribute);
    if (target === null || target.id === draggedId) {
      clearDropCandidates();
      return;
    }
    const rect = target.element.getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    updateTarget({
      kind: "internal",
      id: target.id,
      position: y < midY ? "before" : "after",
    });
  }

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

  function scheduleAutoScroll() {
    if (autoScrollFrame !== null) return;
    if (autoScrollDelta() === 0) return;
    autoScrollFrame = requestAnimationFrame(runAutoScroll);
  }

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

  function stopAutoScroll() {
    if (autoScrollFrame !== null) {
      cancelAnimationFrame(autoScrollFrame);
      autoScrollFrame = null;
    }
    scrollContainer = null;
  }

  function findDropTarget(
    x: number,
    y: number,
    selector: string | undefined,
    idAttribute: string,
  ): { id: number; element: HTMLElement } | null {
    if (selector === undefined) return null;
    const hit = document.elementFromPoint(x, y);
    if (!(hit instanceof Element)) return null;
    const row = hit.closest<HTMLElement>(selector);
    if (!row) return null;
    const idStr = row.dataset[idAttribute];
    if (idStr === undefined) return null;
    const id = Number(idStr);
    if (!Number.isFinite(id)) return null;
    return { id, element: row };
  }

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

  function handlePointerCancel(event: PointerEvent) {
    if (activePointerId !== null && event.pointerId !== activePointerId) return;
    cleanupPointerListeners();
    resetDragState();
  }

  function handleLostPointerCapture() {
    cleanupPointerListeners();
    resetDragState();
  }

  function cleanupPointerListeners() {
    if (activePointerId === null) return;
    stopAutoScroll();
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", handlePointerUp);
    window.removeEventListener("pointercancel", handlePointerCancel);
    captureElement?.removeEventListener(
      "lostpointercapture",
      handleLostPointerCapture,
    );
    if (
      activePointerId !== null &&
      captureElement?.hasPointerCapture(activePointerId)
    ) {
      captureElement.releasePointerCapture(activePointerId);
    }
    captureElement = null;
    activePointerId = null;
  }

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

  function clearDropCandidates() {
    updateTarget({ kind: "none" });
  }

  function updateTarget(next: DropTarget) {
    const previousExternalId = externalDropTargetId;
    target = next;
    const nextExternalId = next.kind === "external" ? next.id : null;
    if (previousExternalId !== nextExternalId)
      options?.onExternalDropTargetChange?.(nextExternalId);
  }

  function resetDragState() {
    drag = { phase: "idle" };
    clearDropCandidates();
  }

  function dispose() {
    cleanupPointerListeners();
    resetDragState();
  }

  return {
    get draggedId() {
      return draggedId;
    },
    get isActive() {
      return isActive;
    },
    get dropTargetId() {
      return dropTargetId;
    },
    get dropPosition() {
      return dropPosition;
    },
    handleDragStart,
    dispose,
  };
}
