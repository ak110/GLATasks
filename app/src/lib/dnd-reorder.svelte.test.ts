/**
 * @fileoverview D&D 並び替えユーティリティのユニットテスト
 *
 * createDragReorder は Svelte 5 の $state rune を使うため dom project（svelte.test.ts）で実行する。
 * Svelte コンポーネントはマウントせず、ユーティリティ関数を直接呼び出して状態遷移を検証する。
 */

import { describe, expect, it, vi } from "vitest";

import { createDragReorder } from "./dnd-reorder.svelte.js";

/** テスト用アイテムを生成するヘルパー */
function makeItems(ids: number[]) {
  return ids.map((id) => ({ id }));
}

describe("createDragReorder", () => {
  it("初期状態では draggedId / dropTargetId / dropPosition がすべて null", () => {
    const dnd = createDragReorder(() => makeItems([1, 2, 3]), vi.fn());
    expect(dnd.draggedId).toBeNull();
    expect(dnd.dropTargetId).toBeNull();
    expect(dnd.dropPosition).toBeNull();
  });

  it("handleDragStart を呼ぶと draggedId が設定される", () => {
    const dnd = createDragReorder(() => makeItems([1, 2, 3]), vi.fn());
    dnd.handleDragStart(1);
    expect(dnd.draggedId).toBe(1);
  });

  it("handleDragOver を呼ぶと dropTargetId と dropPosition が設定される（before）", () => {
    const dnd = createDragReorder(() => makeItems([1, 2, 3]), vi.fn());
    dnd.handleDragStart(1);

    // カーソルが要素の上半分にあるとき before になる
    const mockEvent = {
      currentTarget: {
        getBoundingClientRect: () => ({ top: 100, height: 100 }),
      },
      clientY: 110, // midY=150 より上 → before
    } as unknown as DragEvent;

    dnd.handleDragOver(2, mockEvent);
    expect(dnd.dropTargetId).toBe(2);
    expect(dnd.dropPosition).toBe("before");
  });

  it("handleDragOver を呼ぶと dropTargetId と dropPosition が設定される（after）", () => {
    const dnd = createDragReorder(() => makeItems([1, 2, 3]), vi.fn());
    dnd.handleDragStart(1);

    // カーソルが要素の下半分にあるとき after になる
    const mockEvent = {
      currentTarget: {
        getBoundingClientRect: () => ({ top: 100, height: 100 }),
      },
      clientY: 160, // midY=150 より下 → after
    } as unknown as DragEvent;

    dnd.handleDragOver(2, mockEvent);
    expect(dnd.dropTargetId).toBe(2);
    expect(dnd.dropPosition).toBe("after");
  });

  it("自分自身へのドラッグオーバーは無視される", () => {
    const dnd = createDragReorder(() => makeItems([1, 2, 3]), vi.fn());
    dnd.handleDragStart(1);

    const mockEvent = {
      currentTarget: {
        getBoundingClientRect: () => ({ top: 100, height: 100 }),
      },
      clientY: 110,
    } as unknown as DragEvent;

    dnd.handleDragOver(1, mockEvent); // 自分自身
    expect(dnd.dropTargetId).toBeNull();
    expect(dnd.dropPosition).toBeNull();
  });

  it("handleDrop を呼ぶと onReorder が新しい順序で呼ばれる（before）", () => {
    const onReorder = vi.fn();
    const dnd = createDragReorder(() => makeItems([1, 2, 3]), onReorder);

    // アイテム 3 をアイテム 2 の前へ移動
    dnd.handleDragStart(3);
    const mockEvent = {
      currentTarget: {
        getBoundingClientRect: () => ({ top: 100, height: 100 }),
      },
      clientY: 110, // before
    } as unknown as DragEvent;
    dnd.handleDragOver(2, mockEvent);
    dnd.handleDrop();

    expect(onReorder).toHaveBeenCalledWith([1, 3, 2]);
  });

  it("handleDrop を呼ぶと onReorder が新しい順序で呼ばれる（after）", () => {
    const onReorder = vi.fn();
    const dnd = createDragReorder(() => makeItems([1, 2, 3]), onReorder);

    // アイテム 1 をアイテム 2 の後ろへ移動
    dnd.handleDragStart(1);
    const mockEvent = {
      currentTarget: {
        getBoundingClientRect: () => ({ top: 100, height: 100 }),
      },
      clientY: 160, // after
    } as unknown as DragEvent;
    dnd.handleDragOver(2, mockEvent);
    dnd.handleDrop();

    expect(onReorder).toHaveBeenCalledWith([2, 1, 3]);
  });

  it("handleDrop 後は状態がリセットされる", () => {
    const dnd = createDragReorder(() => makeItems([1, 2, 3]), vi.fn());

    dnd.handleDragStart(1);
    const mockEvent = {
      currentTarget: {
        getBoundingClientRect: () => ({ top: 100, height: 100 }),
      },
      clientY: 160,
    } as unknown as DragEvent;
    dnd.handleDragOver(2, mockEvent);
    dnd.handleDrop();

    expect(dnd.draggedId).toBeNull();
    expect(dnd.dropTargetId).toBeNull();
    expect(dnd.dropPosition).toBeNull();
  });

  it("resetDragState を呼ぶと状態がリセットされる（ドラッグ中断）", () => {
    const dnd = createDragReorder(() => makeItems([1, 2, 3]), vi.fn());

    dnd.handleDragStart(2);
    dnd.resetDragState();

    expect(dnd.draggedId).toBeNull();
    expect(dnd.dropTargetId).toBeNull();
    expect(dnd.dropPosition).toBeNull();
  });

  it("draggedId が null のとき handleDrop は onReorder を呼ばない", () => {
    const onReorder = vi.fn();
    const dnd = createDragReorder(() => makeItems([1, 2, 3]), onReorder);

    // handleDragStart を呼ばずにドロップ → draggedId が null
    dnd.handleDrop();
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("dropTargetId が null のとき handleDrop は onReorder を呼ばない", () => {
    const onReorder = vi.fn();
    const dnd = createDragReorder(() => makeItems([1, 2, 3]), onReorder);

    // handleDragStart 後に handleDragOver を呼ばずにドロップ → dropTargetId が null
    dnd.handleDragStart(1);
    dnd.handleDrop();
    expect(onReorder).not.toHaveBeenCalled();
  });
});
