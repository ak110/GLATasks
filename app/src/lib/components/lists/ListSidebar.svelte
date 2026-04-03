<script lang="ts">
    /**
     * @fileoverview リストサイドバー（リスト一覧表示 + リスト追加フォーム）
     */

    import type { ListInfo } from "$lib/types";
    import ListItem from "./ListItem.svelte";

    type Props = {
        lists: ListInfo[];
        selectedListId: number | null;
        isLoading: boolean;
        mobileView: "lists" | "tasks";
        openMenuId: number | null;
        addListTitle: string;
        dragOverListId?: number | null;
        onSelect: (listId: number) => void;
        onToggleMenu: (listId: number) => void;
        onRename: (listId: number, currentTitle: string) => void;
        onArchive: (listId: number) => void;
        onUnarchive: (listId: number) => void;
        onMerge: (listId: number) => void;
        onDelete: (listId: number) => void;
        onAddList: (title: string) => void;
        onTaskDragOver?: (listId: number) => void;
        onTaskDrop?: (taskId: number, targetListId: number) => void;
    };

    let {
        lists,
        selectedListId,
        isLoading,
        mobileView,
        openMenuId,
        addListTitle = $bindable(),
        dragOverListId = null,
        onSelect,
        onToggleMenu,
        onRename,
        onArchive,
        onUnarchive,
        onMerge,
        onDelete,
        onAddList,
        onTaskDragOver,
        onTaskDrop,
    }: Props = $props();

    function handleAddList(e: Event) {
        e.preventDefault();
        const title = addListTitle.trim();
        if (title) {
            onAddList(title);
        }
    }
</script>

<aside
    class="flex-col border-r border-gray-200 bg-white sm:flex sm:w-56 sm:shrink-0 dark:border-gray-700 dark:bg-gray-800"
    class:flex={mobileView === "lists"}
    class:w-full={mobileView === "lists"}
    class:hidden={mobileView !== "lists"}
>
    <div class="flex-1 overflow-y-auto">
        {#each lists as list (list.id)}
            <ListItem
                {list}
                isSelected={selectedListId === list.id}
                {openMenuId}
                isDragOver={dragOverListId === list.id}
                {onSelect}
                {onToggleMenu}
                {onRename}
                {onArchive}
                {onUnarchive}
                {onMerge}
                {onDelete}
                onTaskDragOver={() => onTaskDragOver?.(list.id)}
                onTaskDrop={(taskId) => onTaskDrop?.(taskId, list.id)}
            />
        {/each}
        {#if lists.length === 0 && !isLoading}
            <p class="p-4 text-gray-400 dark:text-gray-500">リストなし</p>
        {/if}
    </div>
    <!-- リスト追加フォーム -->
    <div class="border-t border-gray-200 p-3 dark:border-gray-700">
        <form onsubmit={handleAddList} class="flex gap-2">
            <input
                type="text"
                bind:value={addListTitle}
                placeholder="新しいリスト"
                class="min-w-0 flex-1 rounded border border-gray-200 px-2.5 py-1.5 focus:border-blue-400 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
            />
            <button
                type="submit"
                class="cursor-pointer rounded bg-blue-600 px-3 py-1.5 text-sm text-white hover:bg-blue-700"
                >追加</button
            >
        </form>
    </div>
</aside>
