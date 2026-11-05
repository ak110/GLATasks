import { flushSync } from "svelte";
import { SvelteMap } from "svelte/reactivity";
import { QueryClient } from "@tanstack/svelte-query";
import { afterEach, describe, expect, it } from "vitest";
import type { RouterOutputs } from "#lib/client/trpc.ts";
import { createMainState } from "./main-state.svelte.ts";
import { createMainNavigation } from "./main-navigation.svelte.ts";

describe("リスト選択の正規化", () => {
  let cleanup: (() => void) | undefined;
  afterEach(() => {
    cleanup?.();
    history.replaceState({}, "", "/");
    localStorage.clear();
  });

  it("選択中のリストが空一覧への更新で消えたら、選択・hash・保存値を解除する", () => {
    const lists = new SvelteMap<string, RouterOutputs["lists"]["list"]>();
    const state = createMainState();
    history.replaceState({}, "", "/#1");
    lists.set("data", [
      {
        id: 1,
        title: "A",
        status: "active",
        sortOrder: 0,
        lastUpdated: "2026-11-06T00:00:00Z",
        todoCount: 0,
      },
    ]);
    cleanup = $effect.root(() => {
      createMainNavigation(
        new QueryClient(),
        state,
        () => lists.get("data")!,
        () => true,
      );
    });
    flushSync();
    expect(state.selectedListId).toBe(1);
    lists.set("data", []);
    flushSync();
    expect(state.selectedListId).toBeNull();
    expect(state.hasHash).toBe(false);
    expect(location.hash).toBe("");
    expect(localStorage.getItem("selectedList")).toBeNull();
  });
});
