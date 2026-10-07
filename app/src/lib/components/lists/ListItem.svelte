<script lang="ts">
    import { menuBehavior } from "#lib/actions/menu.ts";
    import {
        menuFrameClass,
        menuItemClass,
        menuDangerItemClass,
    } from "#lib/components/ui/styles.ts";
    /**
     * @fileoverview リストアイテム（選択ボタン + 操作メニュー）
     */

    import type { ListInfo } from "#lib/types.ts";

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
        onOpenSchedules: (listId: number) => void;
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
        onOpenSchedules,
    }: Props = $props();
</script>

<div
    class="group flex items-center border-b border-gray-200 dark:border-gray-700 dark:text-gray-100 {isSelected
        ? 'bg-blue-50 dark:bg-blue-900/30'
        : ''} {isDragOver
        ? 'bg-blue-50 ring-2 ring-blue-400 ring-inset dark:bg-blue-900/30 dark:ring-blue-500'
        : ''}"
    data-testid="list-item"
    data-task-drop-list-id={isSelected ? undefined : list.id}
    role="listitem"
>
    <button
        class="flex min-w-0 flex-1 cursor-pointer items-center gap-1.5 truncate px-4 py-2.5 text-left"
        class:font-medium={isSelected}
        data-testid="list-select-btn"
        onclick={() => onSelect(list.id)}
    >
        <span class="min-w-0 flex-1 truncate">{list.title}</span>
        {#if list.todo_count > 0}
            <span
                class="inline-flex shrink-0 items-center rounded-full bg-red-500 px-1.5 py-0.5 text-xs text-white"
                data-testid="todo-badge"
            >
                {list.todo_count}
            </span>
        {/if}
    </button>
    <!-- ⋮ メニュー -->
    <div
        class="relative flex-shrink-0"
        use:menuBehavior={{
            open: openMenuId === list.id,
            onClose: () => onToggleMenu(list.id),
        }}
    >
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
            <div class={menuFrameClass} data-menu-frame>
                <button
                    class={menuItemClass}
                    onclick={() => {
                        onRename(list.id, list.title);
                        onToggleMenu(list.id);
                    }}
                >
                    名前変更
                </button>
                {#if list.status === "archived"}
                    <button
                        class={menuItemClass}
                        onclick={() => {
                            onUnarchive(list.id);
                            onToggleMenu(list.id);
                        }}
                    >
                        アーカイブ解除
                    </button>
                {:else}
                    <button
                        class={menuItemClass}
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
                        class={menuItemClass}
                        onclick={() => {
                            onMerge(list.id);
                            onToggleMenu(list.id);
                        }}
                    >
                        他のリストに統合
                    </button>
                {/if}
                <button
                    class={menuItemClass}
                    data-testid="list-schedules-btn"
                    onclick={() => {
                        onOpenSchedules(list.id);
                        onToggleMenu(list.id);
                    }}
                >
                    定期TODO
                </button>
                <hr class="my-1 border-gray-200 dark:border-gray-600" />
                <button
                    class={menuDangerItemClass}
                    data-testid="list-delete-btn"
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
