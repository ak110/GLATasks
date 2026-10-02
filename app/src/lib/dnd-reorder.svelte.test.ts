/**
 * @fileoverview D&D 並び替えユーティリティのユニットテスト
 *
 * `createDragReorder` は Svelte 5 の `$state` rune を使うため dom project（svelte.test.ts）で実行する。
 * Svelte コンポーネントはマウントせず、ユーティリティ関数を直接呼び出して状態遷移を検証する。
 *
 * Pointer Events 化に伴い、`document.elementFromPoint` を伴う hit-testing は
 * happy-dom のレイアウト計算が安定しないため `vi.spyOn` でモックする。
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import { createDragReorder } from "./dnd-reorder.svelte.js";

/** テスト用アイテムを生成する */
function makeItems(ids: number[]) {
  return ids.map((id) => ({ id }));
}

/**
 * `data-reorder-id` を持つ行要素を生成する。
 * `getBoundingClientRect` を任意の値に固定し、hit-testing と before/after 判定の挙動を制御する。
 */
function makeRowElement(id: number, rect = { top: 100, height: 100 }) {
  const el = document.createElement("div");
  el.setAttribute("data-reorder-id", String(id));
  vi.spyOn(el, "getBoundingClientRect").mockReturnValue({
    top: rect.top,
    bottom: rect.top + rect.height,
    height: rect.height,
    left: 0,
    right: 0,
    width: 0,
    x: 0,
    y: rect.top,
    toJSON: () => ({}),
  });
  return el;
}

/** ハンドル要素に対する pointerdown を模した PointerEvent 風オブジェクトを生成する */
function makeStartEvent(
  handle: Element,
  clientX: number,
  clientY: number,
  pointerId = 1,
): PointerEvent {
  return {
    currentTarget: handle,
    pointerId,
    clientX,
    clientY,
  } as unknown as PointerEvent;
}

/** `data-task-drop-list-id` を持つ外部ドロップ先要素を生成する */
function makeExternalDropTarget(listId: number) {
  const el = document.createElement("div");
  el.setAttribute("data-task-drop-list-id", String(listId));
  return el;
}

/** window へ pointermove を発火する */
function dispatchPointerMove(clientX: number, clientY: number, pointerId = 1) {
  window.dispatchEvent(
    new PointerEvent("pointermove", { clientX, clientY, pointerId }),
  );
}

/** window へ pointerup を発火する */
function dispatchPointerUp(pointerId = 1) {
  window.dispatchEvent(new PointerEvent("pointerup", { pointerId }));
}

/** window へ pointercancel を発火する */
function dispatchPointerCancel(pointerId = 1) {
  window.dispatchEvent(new PointerEvent("pointercancel", { pointerId }));
}

describe("createDragReorder", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("初期状態では draggedId / isActive / dropTargetId / dropPosition がリセット済み", () => {
    const dnd = createDragReorder(() => makeItems([1, 2, 3]), vi.fn());
    expect(dnd.draggedId).toBeNull();
    expect(dnd.isActive).toBe(false);
    expect(dnd.dropTargetId).toBeNull();
    expect(dnd.dropPosition).toBeNull();
  });

  it("handleDragStart を呼ぶと draggedId が設定される", () => {
    const dnd = createDragReorder(() => makeItems([1, 2, 3]), vi.fn());
    const handle = document.createElement("span");
    dnd.handleDragStart(1, makeStartEvent(handle, 0, 0));
    expect(dnd.draggedId).toBe(1);
    expect(dnd.isActive).toBe(false);
    dispatchPointerCancel();
  });

  it("pointermove で dropTargetId / dropPosition が設定される（before）", () => {
    const dnd = createDragReorder(() => makeItems([1, 2, 3]), vi.fn());
    const handle = document.createElement("span");
    dnd.handleDragStart(1, makeStartEvent(handle, 0, 0));

    const row = makeRowElement(2);
    vi.spyOn(document, "elementFromPoint").mockReturnValue(row);
    // midY=150 より上 → before
    dispatchPointerMove(20, 110);
    expect(dnd.dropTargetId).toBe(2);
    expect(dnd.dropPosition).toBe("before");
    dispatchPointerCancel();
  });

  it("pointermove で dropTargetId / dropPosition が設定される（after）", () => {
    const dnd = createDragReorder(() => makeItems([1, 2, 3]), vi.fn());
    const handle = document.createElement("span");
    dnd.handleDragStart(1, makeStartEvent(handle, 0, 0));

    const row = makeRowElement(2);
    vi.spyOn(document, "elementFromPoint").mockReturnValue(row);
    // midY=150 より下 → after
    dispatchPointerMove(20, 160);
    expect(dnd.dropTargetId).toBe(2);
    expect(dnd.dropPosition).toBe("after");
    dispatchPointerCancel();
  });

  it("自分自身へのドラッグオーバーは無視される", () => {
    const dnd = createDragReorder(() => makeItems([1, 2, 3]), vi.fn());
    const handle = document.createElement("span");
    dnd.handleDragStart(1, makeStartEvent(handle, 0, 0));

    const row = makeRowElement(1);
    vi.spyOn(document, "elementFromPoint").mockReturnValue(row);
    dispatchPointerMove(20, 110);
    expect(dnd.dropTargetId).toBeNull();
    expect(dnd.dropPosition).toBeNull();
    dispatchPointerCancel();
  });

  it("pointerup で onReorder が新しい順序で呼ばれる（before）", () => {
    const onReorder = vi.fn();
    const dnd = createDragReorder(() => makeItems([1, 2, 3]), onReorder);

    const handle = document.createElement("span");
    dnd.handleDragStart(3, makeStartEvent(handle, 0, 0));
    const row = makeRowElement(2);
    vi.spyOn(document, "elementFromPoint").mockReturnValue(row);
    dispatchPointerMove(20, 110);
    dispatchPointerUp();

    // アイテム 3 をアイテム 2 の前へ移動
    expect(onReorder).toHaveBeenCalledWith([1, 3, 2]);
  });

  it("pointerup で onReorder が新しい順序で呼ばれる（after）", () => {
    const onReorder = vi.fn();
    const dnd = createDragReorder(() => makeItems([1, 2, 3]), onReorder);

    const handle = document.createElement("span");
    dnd.handleDragStart(1, makeStartEvent(handle, 0, 0));
    const row = makeRowElement(2);
    vi.spyOn(document, "elementFromPoint").mockReturnValue(row);
    dispatchPointerMove(20, 160);
    dispatchPointerUp();

    // アイテム 1 をアイテム 2 の後ろへ移動
    expect(onReorder).toHaveBeenCalledWith([2, 1, 3]);
  });

  it("pointerup 後は状態がリセットされる", () => {
    const dnd = createDragReorder(() => makeItems([1, 2, 3]), vi.fn());

    const handle = document.createElement("span");
    dnd.handleDragStart(1, makeStartEvent(handle, 0, 0));
    const row = makeRowElement(2);
    vi.spyOn(document, "elementFromPoint").mockReturnValue(row);
    dispatchPointerMove(20, 160);
    dispatchPointerUp();

    expect(dnd.draggedId).toBeNull();
    expect(dnd.isActive).toBe(false);
    expect(dnd.dropTargetId).toBeNull();
    expect(dnd.dropPosition).toBeNull();
  });

  it("pointercancel を受領すると状態がリセットされる（ドラッグ中断）", () => {
    const dnd = createDragReorder(() => makeItems([1, 2, 3]), vi.fn());

    const handle = document.createElement("span");
    dnd.handleDragStart(2, makeStartEvent(handle, 0, 0));
    dispatchPointerCancel();

    expect(dnd.draggedId).toBeNull();
    expect(dnd.isActive).toBe(false);
    expect(dnd.dropTargetId).toBeNull();
    expect(dnd.dropPosition).toBeNull();
  });

  it("ドラッグ開始前の pointerup は onReorder を呼ばない", () => {
    const onReorder = vi.fn();
    createDragReorder(() => makeItems([1, 2, 3]), onReorder);

    dispatchPointerUp();
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("dropTargetId が null のとき pointerup は onReorder を呼ばない", () => {
    const onReorder = vi.fn();
    const dnd = createDragReorder(() => makeItems([1, 2, 3]), onReorder);

    const handle = document.createElement("span");
    dnd.handleDragStart(1, makeStartEvent(handle, 0, 0));
    vi.spyOn(document, "elementFromPoint").mockReturnValue(
      document.createElement("div"),
    );
    dispatchPointerMove(20, 110);
    dispatchPointerUp();
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("pointermove が閾値未満の場合 isActive は立たず onReorder も呼ばれない", () => {
    const onReorder = vi.fn();
    const dnd = createDragReorder(() => makeItems([1, 2, 3]), onReorder);

    const handle = document.createElement("span");
    dnd.handleDragStart(1, makeStartEvent(handle, 0, 0));

    // 閾値（既定 5px）未満の移動
    dispatchPointerMove(2, 2);
    expect(dnd.isActive).toBe(false);

    // pointerup でドロップ確定するが、isActive=false のため onReorder は呼ばれない
    dispatchPointerUp();
    expect(onReorder).not.toHaveBeenCalled();
    expect(dnd.draggedId).toBeNull();
  });

  it("閾値を超えた pointermove で hit-testing 経由のドロップが成立する（before）", () => {
    const onReorder = vi.fn();
    const dnd = createDragReorder(() => makeItems([1, 2, 3]), onReorder);

    const handle = document.createElement("span");
    const row = makeRowElement(2);
    document.body.appendChild(row);

    // hit-testing で行要素を返すようモック
    vi.spyOn(document, "elementFromPoint").mockReturnValue(row);

    // アイテム 3 をアイテム 2 の前へ移動 → 期待: [1, 3, 2]
    dnd.handleDragStart(3, makeStartEvent(handle, 0, 0));
    // 閾値超過 + midY=150 より上 → before
    dispatchPointerMove(20, 110);
    expect(dnd.isActive).toBe(true);
    expect(dnd.dropTargetId).toBe(2);
    expect(dnd.dropPosition).toBe("before");

    dispatchPointerUp();
    expect(onReorder).toHaveBeenCalledWith([1, 3, 2]);

    document.body.removeChild(row);
  });

  it("hit-testing で対象要素が見つからない場合は dropTargetId がクリアされる", () => {
    const dnd = createDragReorder(() => makeItems([1, 2, 3]), vi.fn());

    const handle = document.createElement("span");
    // 並び替え対象の data-reorder-id を持たない要素を返す
    vi.spyOn(document, "elementFromPoint").mockReturnValue(
      document.createElement("div"),
    );

    dnd.handleDragStart(1, makeStartEvent(handle, 0, 0));
    dispatchPointerMove(20, 110);
    expect(dnd.isActive).toBe(true);
    expect(dnd.dropTargetId).toBeNull();
    expect(dnd.dropPosition).toBeNull();
    dispatchPointerCancel();
  });

  it("外部ドロップ候補と並び替え候補を排他的に切り替え、pointerup で外部ドロップを確定する", () => {
    const onReorder = vi.fn();
    const onExternalDrop = vi.fn();
    const onExternalDropTargetChange = vi.fn();
    const dnd = createDragReorder(() => makeItems([1, 2, 3]), onReorder, {
      externalDropTargetSelector: "[data-task-drop-list-id]",
      externalDropTargetIdAttribute: "taskDropListId",
      onExternalDropTargetChange,
      onExternalDrop,
    });

    const row = makeRowElement(2);
    const externalTarget = makeExternalDropTarget(10);
    vi.spyOn(document, "elementFromPoint").mockImplementation((x) => {
      if (x < 30) return externalTarget;
      if (x < 60) return row;
      return document.createElement("div");
    });

    const handle = document.createElement("span");
    dnd.handleDragStart(1, makeStartEvent(handle, 0, 0));

    dispatchPointerMove(20, 110);
    expect(dnd.isActive).toBe(true);
    expect(dnd.dropTargetId).toBeNull();
    expect(dnd.dropPosition).toBeNull();
    expect(onExternalDropTargetChange).toHaveBeenLastCalledWith(10);

    dispatchPointerMove(40, 110);
    expect(dnd.dropTargetId).toBe(2);
    expect(dnd.dropPosition).toBe("before");
    expect(onExternalDropTargetChange).toHaveBeenLastCalledWith(null);

    dispatchPointerMove(80, 110);
    expect(dnd.dropTargetId).toBeNull();
    expect(dnd.dropPosition).toBeNull();
    expect(onExternalDropTargetChange).toHaveBeenLastCalledWith(null);

    dispatchPointerMove(20, 110);
    dispatchPointerUp();
    expect(onExternalDrop).toHaveBeenCalledWith(1, 10);
    expect(onReorder).not.toHaveBeenCalled();
    expect(dnd.draggedId).toBeNull();
    expect(dnd.isActive).toBe(false);
    expect(onExternalDropTargetChange).toHaveBeenLastCalledWith(null);
  });

  it("別の pointerId のイベントを無視する", () => {
    const dnd = createDragReorder(() => makeItems([1, 2, 3]), vi.fn());
    const row = makeRowElement(2);
    vi.spyOn(document, "elementFromPoint").mockReturnValue(row);

    const handle = document.createElement("span");
    dnd.handleDragStart(1, makeStartEvent(handle, 0, 0, 1));
    dispatchPointerMove(20, 110, 2);
    dispatchPointerUp(2);
    expect(dnd.draggedId).toBe(1);
    expect(dnd.isActive).toBe(false);

    dispatchPointerMove(20, 110, 1);
    expect(dnd.isActive).toBe(true);
    dispatchPointerUp(1);
  });

  it("pointercancel でドラッグ状態がリセットされる", () => {
    const onReorder = vi.fn();
    const dnd = createDragReorder(() => makeItems([1, 2, 3]), onReorder);

    const handle = document.createElement("span");
    dnd.handleDragStart(1, makeStartEvent(handle, 0, 0));
    expect(dnd.draggedId).toBe(1);

    dispatchPointerCancel();
    expect(dnd.draggedId).toBeNull();
    expect(dnd.isActive).toBe(false);
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("外部ドロップ候補がある状態でも pointercancel で候補が消える", () => {
    const onExternalDropTargetChange = vi.fn();
    const onExternalDrop = vi.fn();
    const dnd = createDragReorder(() => makeItems([1, 2, 3]), vi.fn(), {
      externalDropTargetSelector: "[data-task-drop-list-id]",
      externalDropTargetIdAttribute: "taskDropListId",
      onExternalDropTargetChange,
      onExternalDrop,
    });
    const externalTarget = makeExternalDropTarget(10);
    vi.spyOn(document, "elementFromPoint").mockReturnValue(externalTarget);

    const handle = document.createElement("span");
    dnd.handleDragStart(1, makeStartEvent(handle, 0, 0));
    dispatchPointerMove(20, 110);
    expect(onExternalDropTargetChange).toHaveBeenLastCalledWith(10);

    dispatchPointerCancel();
    expect(dnd.draggedId).toBeNull();
    expect(dnd.isActive).toBe(false);
    expect(onExternalDropTargetChange).toHaveBeenLastCalledWith(null);
    expect(onExternalDrop).not.toHaveBeenCalled();
  });

  it("lostpointercapture でドラッグ状態がリセットされる", () => {
    const onReorder = vi.fn();
    const dnd = createDragReorder(() => makeItems([1, 2, 3]), onReorder);

    const handle = document.createElement("span");
    dnd.handleDragStart(1, makeStartEvent(handle, 0, 0));
    expect(dnd.draggedId).toBe(1);

    handle.dispatchEvent(new Event("lostpointercapture"));
    expect(dnd.draggedId).toBeNull();
    expect(dnd.isActive).toBe(false);
    expect(onReorder).not.toHaveBeenCalled();
  });

  it("外部ドロップ候補がある状態でも lostpointercapture で候補が消える", () => {
    const onExternalDropTargetChange = vi.fn();
    const dnd = createDragReorder(() => makeItems([1, 2, 3]), vi.fn(), {
      externalDropTargetSelector: "[data-task-drop-list-id]",
      externalDropTargetIdAttribute: "taskDropListId",
      onExternalDropTargetChange,
    });
    const externalTarget = makeExternalDropTarget(10);
    vi.spyOn(document, "elementFromPoint").mockReturnValue(externalTarget);

    const handle = document.createElement("span");
    dnd.handleDragStart(1, makeStartEvent(handle, 0, 0));
    dispatchPointerMove(20, 110);
    expect(onExternalDropTargetChange).toHaveBeenLastCalledWith(10);

    handle.dispatchEvent(new Event("lostpointercapture"));
    expect(dnd.draggedId).toBeNull();
    expect(dnd.isActive).toBe(false);
    expect(onExternalDropTargetChange).toHaveBeenLastCalledWith(null);
  });
});

describe("createDragReorder の自動スクロール", () => {
  /** requestAnimationFrame を手動で進めるためのキュー */
  let frames: Map<number, FrameRequestCallback>;
  let nextFrameId: number;

  /** 予約済みのフレームを1つずつ実行する */
  function runFrames(count: number) {
    for (let i = 0; i < count; i++) {
      const entry = frames.entries().next();
      if (entry.done) return;
      const [id, callback] = entry.value;
      frames.delete(id);
      callback(0);
    }
  }

  /**
   * 縦スクロール要素（表示高さ400px、内容1000px）と、その内側のハンドルを生成する。
   * 横範囲は x=0〜300。
   */
  function setupScrollContainer() {
    const container = document.createElement("div");
    container.style.overflowY = "auto";
    Object.defineProperty(container, "scrollHeight", { value: 1000 });
    Object.defineProperty(container, "clientHeight", { value: 400 });
    vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
      top: 0,
      bottom: 400,
      height: 400,
      left: 0,
      right: 300,
      width: 300,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });
    const handle = document.createElement("span");
    container.appendChild(handle);
    document.body.appendChild(container);
    return { container, handle };
  }

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  function mockAnimationFrame() {
    frames = new Map();
    nextFrameId = 1;
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((cb) => {
      const id = nextFrameId++;
      frames.set(id, cb);
      return id;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation((id) => {
      frames.delete(id);
    });
  }

  it("下端付近で保持すると下へスクロールし、スクロール後の行をドロップ先として再判定する", () => {
    mockAnimationFrame();
    const { container, handle } = setupScrollContainer();
    const onReorder = vi.fn();
    const dnd = createDragReorder(() => makeItems([1, 2, 3]), onReorder);

    const row2 = makeRowElement(2, { top: 350, height: 40 });
    const row3 = makeRowElement(3, { top: 350, height: 40 });
    let hit: Element = row2;
    vi.spyOn(document, "elementFromPoint").mockImplementation(() => hit);

    dnd.handleDragStart(1, makeStartEvent(handle, 100, 10));
    dispatchPointerMove(100, 390);
    expect(dnd.dropTargetId).toBe(2);
    expect(frames.size).toBe(1);

    // 指を止めたまま一覧だけが動き、ポインター下の行が変わる
    hit = row3;
    runFrames(1);
    expect(container.scrollTop).toBeGreaterThan(0);
    expect(dnd.dropTargetId).toBe(3);
    expect(dnd.dropPosition).toBe("after");

    dispatchPointerUp();
    expect(onReorder).toHaveBeenCalledWith([2, 3, 1]);
  });

  it("上端付近で保持すると上へスクロールする", () => {
    mockAnimationFrame();
    const { container, handle } = setupScrollContainer();
    container.scrollTop = 300;
    const dnd = createDragReorder(() => makeItems([1, 2, 3]), vi.fn());
    vi.spyOn(document, "elementFromPoint").mockReturnValue(null);

    dnd.handleDragStart(3, makeStartEvent(handle, 100, 200));
    dispatchPointerMove(100, 5);
    runFrames(1);
    expect(container.scrollTop).toBeLessThan(300);
    dispatchPointerCancel();
  });

  it("横方向がスクロール要素の範囲外ならスクロールしない", () => {
    mockAnimationFrame();
    const { container, handle } = setupScrollContainer();
    const dnd = createDragReorder(() => makeItems([1, 2, 3]), vi.fn());
    vi.spyOn(document, "elementFromPoint").mockReturnValue(null);

    dnd.handleDragStart(1, makeStartEvent(handle, 100, 10));
    dispatchPointerMove(500, 390);
    runFrames(5);
    expect(frames.size).toBe(0);
    expect(container.scrollTop).toBe(0);
    dispatchPointerCancel();
  });

  it("ドロップまたはキャンセル後は予約済みのスクロールを取り消し、以後スクロールしない", () => {
    mockAnimationFrame();
    const { container, handle } = setupScrollContainer();
    const dnd = createDragReorder(() => makeItems([1, 2, 3]), vi.fn());
    vi.spyOn(document, "elementFromPoint").mockReturnValue(null);

    dnd.handleDragStart(1, makeStartEvent(handle, 100, 10));
    dispatchPointerMove(100, 390);
    expect(frames.size).toBe(1);
    dispatchPointerUp();
    expect(frames.size).toBe(0);
    runFrames(5);
    expect(container.scrollTop).toBe(0);

    dnd.handleDragStart(1, makeStartEvent(handle, 100, 10, 2));
    dispatchPointerMove(100, 390, 2);
    expect(frames.size).toBe(1);
    dispatchPointerCancel(2);
    expect(frames.size).toBe(0);
    expect(container.scrollTop).toBe(0);
  });
});
