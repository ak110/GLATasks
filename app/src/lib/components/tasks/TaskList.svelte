<script lang="ts">
    import type { TaskStatus } from "#lib/schemas.ts";
    import { onDestroy } from "svelte";
    import type { TaskListItem } from "#lib/types.ts";
    import { createDragReorder } from "#lib/actions/dnd-reorder.svelte.ts";
    import { isTempTaskId } from "#lib/client/tasks/task-cache.ts";
    import TaskItem from "./TaskItem.svelte";
    import { grayButtonClass } from "#lib/components/ui/styles.ts";

    interface Props {
        tasks: TaskListItem[];
        isLoading: boolean;
        error?: string;
        queryErrorKey?: string;
        onRetry?: () => void;
        onToggle: (taskId: number, nextStatus: TaskStatus) => void;
        onEdit: (task: TaskListItem) => void;
        onReorder?: (taskIds: number[]) => void;
        onTaskDragOver?: (listId: number | null) => void;
        onTaskDrop?: (taskId: number, targetListId: number) => void;
        archivePageActions?: {
            previous: boolean;
            next: boolean;
            disabled: boolean;
            move: (taskId: number, direction: "previous" | "next") => void;
        };
        updatedTaskIds?: Set<number>;
    }

    let {
        tasks,
        isLoading,
        error,
        queryErrorKey,
        onRetry,
        onToggle,
        onEdit,
        onReorder,
        onTaskDragOver,
        onTaskDrop,
        archivePageActions,
        updatedTaskIds,
    }: Props = $props();

    let scrollElement: HTMLDivElement | undefined;

    export function scrollToTop(): void {
        if (scrollElement) scrollElement.scrollTop = 0;
    }

    const dnd = createDragReorder(
        () => tasks,
        (ids) => onReorder?.(ids),
        {
            externalDropTargetSelector: "[data-task-drop-list-id]",
            externalDropTargetIdAttribute: "taskDropListId",
            onExternalDropTargetChange: (listId) => onTaskDragOver?.(listId),
            onExternalDrop: (taskId, targetListId) =>
                onTaskDrop?.(taskId, targetListId),
        },
    );
    onDestroy(() => dnd.dispose());
</script>

<div
    bind:this={scrollElement}
    class="min-h-0 flex-1 overflow-y-auto"
    data-testid="task-list-scroll"
>
    {#if isLoading}
        <p class="p-4 text-gray-400 dark:text-gray-500">読み込み中...</p>
    {:else if error}
        <div
            role="alert"
            data-query-error-key={queryErrorKey}
            class="p-4 text-red-600 dark:text-red-400"
        >
            <p>{error}</p>
            <button type="button" onclick={onRetry} class={grayButtonClass}>
                再試行
            </button>
        </div>
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
                onDragStart={onReorder || onTaskDrop
                    ? dnd.handleDragStart
                    : undefined}
            />
            {#if archivePageActions}
                <div class="flex flex-wrap gap-2 px-4">
                    {#if archivePageActions.previous}
                        <button
                            type="button"
                            class={grayButtonClass}
                            aria-label={`前のページの末尾へ移す: ${task.title}`}
                            disabled={archivePageActions.disabled}
                            onclick={() =>
                                archivePageActions?.move(task.id, "previous")}
                        >
                            前のページの末尾へ移す
                        </button>
                    {/if}
                    {#if archivePageActions.next}
                        <button
                            type="button"
                            class={grayButtonClass}
                            aria-label={`次のページの先頭へ移す: ${task.title}`}
                            disabled={archivePageActions.disabled}
                            onclick={() =>
                                archivePageActions?.move(task.id, "next")}
                        >
                            次のページの先頭へ移す
                        </button>
                    {/if}
                </div>
            {/if}
        {/each}
    {/if}
</div>
