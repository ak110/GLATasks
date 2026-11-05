import { SvelteURLSearchParams } from "svelte/reactivity";
import { queryKeys } from "#lib/client/query-options.ts";
import type { QueryClient } from "@tanstack/svelte-query";
import type { RouterOutputs } from "#lib/client/trpc.ts";
import type { MainState } from "./main-state.svelte.ts";

export function createMainNavigation(
  queryClient: QueryClient,
  state: MainState,
  getLists: () => RouterOutputs["lists"]["list"],
  isListsReady: () => boolean,
) {
  let initialized = false;

  function clearSelection() {
    state.selectedListId = null;
    state.hasHash = false;
    state.addTaskText = "";
    state.updatedTaskIds.clear();
    localStorage.removeItem("selectedList");
    history.replaceState(
      {},
      "",
      window.location.pathname + window.location.search,
    );
  }

  function normalize() {
    if (!isListsReady()) return;
    if (
      state.selectedListId !== null &&
      !getLists().some((list) => list.id === state.selectedListId)
    ) {
      clearSelection();
    }
  }
  // URLハッシュからリストIDを解析
  function parseHashListId(): number | null {
    const hash = window.location.hash;
    if (!hash || hash === "#") return null;
    const id = parseInt(hash.substring(1));
    return isNaN(id) ? null : id;
  }

  // hashchange イベントで URL ハッシュと状態を同期
  // ブラウザのバック/フォワード操作やモバイルのリスト⇔タスク画面遷移を検知する
  $effect(() => {
    function onHashChange() {
      const hashId = parseHashListId();
      state.hasHash = hashId !== null;
      if (hashId !== null) {
        state.selectedListId = hashId;
        localStorage.setItem("selectedList", String(hashId));
      }
      normalize();
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  });

  // リストデータ到着時に選択状態を復元（初回のみ）
  // URLハッシュ > URL パラメータ `list` > localStorage の優先順
  // SSR ではなく $effect で行う理由: window/localStorage/location はブラウザ専用 API のため
  $effect(() => {
    if (!isListsReady()) return;
    if (!initialized) {
      initialized = true;
      // URLハッシュ（ブックマーク・直接アクセス等）
      const hashId = parseHashListId();
      if (getLists().length === 0) {
        clearSelection();
        return;
      }
      if (hashId !== null && !getLists().some((list) => list.id === hashId)) {
        clearSelection();
        return;
      }
      if (hashId && getLists().some((l) => l.id === hashId)) {
        state.selectedListId = hashId;
        state.hasHash = true;
        localStorage.setItem("selectedList", String(hashId));
        return;
      }

      // URL パラメータ（share/ingest からのリダイレクト等、互換性のため残す）
      const urlListId = Number(
        new SvelteURLSearchParams(window.location.search).get("list"),
      );
      if (urlListId && getLists().some((l) => l.id === urlListId)) {
        state.selectedListId = urlListId;
        localStorage.setItem("selectedList", String(urlListId));
        // ?list= をハッシュに置換
        history.replaceState(
          {},
          "",
          window.location.pathname + "#" + urlListId,
        );
        state.hasHash = true;
        return;
      }

      // localStorage フォールバック（ハッシュは付けない → モバイルではリスト一覧から）
      const saved = localStorage.getItem("selectedList");
      const savedId = saved ? parseInt(saved) : null;
      const initial = getLists().find((l) => l.id === savedId) ?? getLists()[0];
      if (initial) {
        state.selectedListId = initial.id;
        localStorage.setItem("selectedList", String(initial.id));
      }
    }

    // 無効なハッシュ対策: リストデータにハッシュのIDが存在しなければハッシュを除去
    if (state.hasHash) {
      const hashId = parseHashListId();
      if (hashId && !getLists().some((l) => l.id === hashId)) {
        clearSelection();
      }
    }
    normalize();
  });

  function selectList(listId: number) {
    if (!getLists().some((list) => list.id === listId)) return;
    state.selectedListId = listId;
    state.addTaskText = "";
    state.updatedTaskIds.clear();
    // ハッシュ更新 → hashchange イベントで state.hasHash と localStorage が同期される
    location.hash = "#" + listId;
  }

  async function changeShowType(type: "active" | "archived" | "all") {
    state.showType = type;
    state.updatedTaskIds.clear();
    await queryClient.invalidateQueries({ queryKey: queryKeys.lists });
    normalize();
  }

  return { selectList, changeShowType };
}
