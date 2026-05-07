<script lang="ts">
    /**
     * @fileoverview タスク一覧表示コンポーネント
     */

    import type { TaskListItem } from "$lib/types";
    import { createDragReorder } from "$lib/dnd-reorder.svelte";
    import TaskItem from "./TaskItem.svelte";

    type Props = {
        tasks: TaskListItem[];
        isLoading: boolean;
        onToggle: (taskId: number, checked: boolean) => void;
        onEdit: (task: TaskListItem) => void;
        onReorder?: (taskIds: number[]) => void;
        updatedTaskIds?: Set<number>;
    };

    let {
        tasks,
        isLoading,
        onToggle,
        onEdit,
        onReorder,
        updatedTaskIds,
    }: Props = $props();

    // D&D 状態管理（onReorder が渡された場合のみ有効化）
    const dnd = createDragReorder(
        () => tasks,
        (ids) => onReorder?.(ids),
    );
</script>

<div class="flex-1">
    {#if isLoading}
        <p class="p-4 text-gray-400 dark:text-gray-500">読み込み中...</p>
    {:else if tasks.length === 0}
        <p class="p-4 text-gray-400 dark:text-gray-500">タスクなし</p>
    {:else}
        {#each tasks as task (task._key)}
            <TaskItem
                {task}
                {onToggle}
                {onEdit}
                isDragging={dnd.isActive && dnd.draggedId === task.id}
                isRemoteUpdated={updatedTaskIds?.has(task.id) ?? false}
                dropIndicator={dnd.isActive && dnd.dropTargetId === task.id
                    ? dnd.dropPosition
                    : null}
                onDragStart={onReorder ? dnd.handleDragStart : undefined}
            />
        {/each}
    {/if}
</div>
