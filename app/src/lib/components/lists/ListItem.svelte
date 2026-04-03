<script lang="ts">
    /**
     * @fileoverview リストアイテム（選択ボタン + 操作メニュー）
     */

    import type { ListInfo } from "$lib/types";

    type Props = {
        list: ListInfo;
        isSelected: boolean;
        openMenuId: number | null;
        isDragOver?: boolean;
        onSelect: (listId: number) => void;
        onToggleMenu: (listId: number) => void;
        onRename: (listId: number, currentTitle: string) => void;
        onArchive: (listId: number) => void;
        onUnarchive: (listId: number) => void;
        onMerge: (listId: number) => void;
        onDelete: (listId: number) => void;
        onTaskDragOver?: () => void;
        onTaskDrop?: (taskId: number) => void;
    };

    let {
        list,
        isSelected,
        openMenuId,
        isDragOver = false,
        onSelect,
        onToggleMenu,
        onRename,
        onArchive,
        onUnarchive,
        onMerge,
        onDelete,
        onTaskDragOver,
        onTaskDrop,
    }: Props = $props();
</script>

<div
    class="group flex items-center border-b border-gray-200 dark:border-gray-700 dark:text-gray-100 {isSelected
        ? 'bg-blue-50 dark:bg-blue-900/30'
        : ''} {isDragOver
        ? 'bg-blue-50 ring-2 ring-blue-400 ring-inset dark:bg-blue-900/30 dark:ring-blue-500'
        : ''}"
    data-testid="list-item"
    role="listitem"
    ondragover={(e) => {
        if (e.dataTransfer?.types.includes("application/x-task-id")) {
            e.preventDefault();
            e.dataTransfer.dropEffect = "move";
            onTaskDragOver?.();
        }
    }}
    ondrop={(e) => {
        e.preventDefault();
        const taskId = Number(e.dataTransfer?.getData("application/x-task-id"));
        if (taskId) onTaskDrop?.(taskId);
    }}
>
    <button
        class="min-w-0 flex-1 cursor-pointer truncate px-4 py-2.5 text-left"
        class:font-medium={isSelected}
        data-testid="list-select-btn"
        onclick={() => onSelect(list.id)}
    >
        {list.title}
    </button>
    <!-- ⋮ メニュー -->
    <div class="relative flex-shrink-0">
        <button
            class="cursor-pointer rounded px-2 py-2.5 text-sm text-gray-400 hover:bg-gray-100 hover:text-gray-700 sm:opacity-0 sm:group-hover:opacity-100 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-200"
            onclick={(e) => {
                e.stopPropagation();
                onToggleMenu(list.id);
            }}
            title="操作メニュー"
            aria-label="操作メニュー"
            data-testid="list-menu-btn"
        >
            ⋮
        </button>
        {#if openMenuId === list.id}
            <div
                class="absolute top-full right-0 z-20 min-w-max rounded border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-600 dark:bg-gray-800"
            >
                <button
                    class="block w-full cursor-pointer px-4 py-1.5 text-left hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-gray-700"
                    onclick={() => {
                        onRename(list.id, list.title);
                        onToggleMenu(list.id);
                    }}
                >
                    名前変更
                </button>
                {#if list.status === "archived"}
                    <button
                        class="block w-full cursor-pointer px-4 py-1.5 text-left hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-gray-700"
                        onclick={() => {
                            onUnarchive(list.id);
                            onToggleMenu(list.id);
                        }}
                    >
                        アーカイブ解除
                    </button>
                {:else}
                    <button
                        class="block w-full cursor-pointer px-4 py-1.5 text-left hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-gray-700"
                        onclick={() => {
                            onArchive(list.id);
                            onToggleMenu(list.id);
                        }}
                    >
                        アーカイブ
                    </button>
                {/if}
                {#if list.status === "active"}
                    <button
                        class="block w-full cursor-pointer px-4 py-1.5 text-left hover:bg-gray-100 dark:text-gray-100 dark:hover:bg-gray-700"
                        onclick={() => {
                            onMerge(list.id);
                            onToggleMenu(list.id);
                        }}
                    >
                        他のリストに統合
                    </button>
                {/if}
                <hr class="my-1 border-gray-200 dark:border-gray-600" />
                <button
                    class="block w-full cursor-pointer px-4 py-1.5 text-left text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-900/30"
                    onclick={() => {
                        onDelete(list.id);
                        onToggleMenu(list.id);
                    }}
                >
                    削除
                </button>
            </div>
        {/if}
    </div>
</div>
