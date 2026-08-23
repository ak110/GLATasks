<script lang="ts">
    /**
     * @fileoverview タスク一覧表示コンポーネント
     */

    import type { TaskStatus } from "$lib/schemas";
    import type { TaskListItem } from "$lib/types";
    import { createDragReorder } from "$lib/dnd-reorder.svelte";
    import { isTempTaskId } from "$lib/task-cache";
    import TaskItem from "./TaskItem.svelte";

    type Props = {
        tasks: TaskListItem[];
        isLoading: boolean;
        onToggle: (taskId: number, nextStatus: TaskStatus) => void;
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

    let scrollElement: HTMLDivElement | undefined;

    export function scrollToTop(): void {
        if (scrollElement) scrollElement.scrollTop = 0;
    }

    // D&D 状態管理（onReorder が渡された場合のみ有効化）
    const dnd = createDragReorder(
        () => tasks,
        (ids) => onReorder?.(ids),
    );
</script>

<div
    bind:this={scrollElement}
    class="min-h-0 flex-1 overflow-y-auto"
    data-testid="task-list-scroll"
>
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
                isTempTask={isTempTaskId(task.id)}
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
