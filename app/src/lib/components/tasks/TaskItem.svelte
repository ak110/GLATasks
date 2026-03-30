<script lang="ts">
    /**
     * @fileoverview タスクアイテム（チェックボックス + テキスト表示 + 編集・コピーボタン）
     */

    import type { TaskInfo } from "$lib/types";
    import { linkify } from "$lib/linkify";

    type Props = {
        task: TaskInfo;
        onToggle: (taskId: number, checked: boolean) => void;
        onEdit: (task: TaskInfo) => void;
        isDragging?: boolean;
        isRemoteUpdated?: boolean;
        dropIndicator?: "before" | "after" | null;
        onDragStart?: (taskId: number) => void;
        onDragOver?: (taskId: number, e: DragEvent) => void;
        onDrop?: () => void;
        onDragEnd?: () => void;
    };

    let {
        task,
        onToggle,
        onEdit,
        isDragging = false,
        isRemoteUpdated = false,
        dropIndicator = null,
        onDragStart,
        onDragOver,
        onDrop,
        onDragEnd,
    }: Props = $props();

    let copyMessage = $state("");
    let notesExpanded = $state(false);
    let notesClamped = $state(false);
    let notesEl: HTMLParagraphElement | undefined = $state();

    // notesが実際にクランプされているか検知
    $effect(() => {
        if (!notesEl) return;
        const check = () => {
            notesClamped = notesEl!.scrollHeight > notesEl!.clientHeight;
        };
        check();
        const observer = new ResizeObserver(check);
        observer.observe(notesEl);
        return () => observer.disconnect();
    });

    async function copyTask() {
        const full = task.notes ? `${task.title}\n${task.notes}` : task.title;
        await navigator.clipboard.writeText(full);
        copyMessage = "コピーしました";
        setTimeout(() => (copyMessage = ""), 2000);
    }
</script>

<div
    class="relative flex items-start gap-3 border-b border-gray-200 px-3 py-3 hover:bg-gray-50 sm:px-5 dark:border-gray-700 dark:hover:bg-gray-700"
    class:opacity-50={task.status === "archived" || isDragging}
    class:border-t-2={dropIndicator === "before"}
    class:border-t-blue-500={dropIndicator === "before"}
    class:border-b-2={dropIndicator === "after"}
    class:border-b-blue-500={dropIndicator === "after"}
    data-testid="task-item"
    role="listitem"
    ondragover={(e) => {
        if (onDragOver) {
            e.preventDefault();
            onDragOver(task.id, e);
        }
    }}
    ondrop={(e) => {
        if (onDrop) {
            e.preventDefault();
            onDrop();
        }
    }}
    ondragend={() => onDragEnd?.()}
>
    <input
        type="checkbox"
        checked={task.status === "completed"}
        onchange={(e) => onToggle(task.id, e.currentTarget.checked)}
        class="mt-1 size-4 cursor-pointer"
    />
    <div
        class="min-w-0 flex-1 wrap-break-word break-all"
        class:line-through={task.status === "completed"}
        data-testid="task-text"
    >
        {#if task.title}
            <p
                class="leading-tight {task.status === 'completed'
                    ? 'text-gray-400 dark:text-gray-500'
                    : 'dark:text-gray-100'}"
            >
                <!-- eslint-disable-next-line svelte/no-at-html-tags -- linkify()が自前でHTMLエスケープ済み -->
                {@html linkify(task.title)}
            </p>
        {/if}
        {#if task.notes}
            <p
                bind:this={notesEl}
                class="mt-0.5 whitespace-pre-wrap {task.status === 'completed'
                    ? 'text-gray-400 dark:text-gray-500'
                    : 'text-gray-500 dark:text-gray-400'}"
                class:line-clamp-5={!notesExpanded}
            >
                <!-- eslint-disable-next-line svelte/no-at-html-tags -- linkify()が自前でHTMLエスケープ済み -->
                {@html linkify(task.notes)}
            </p>
        {/if}
        {#if !task.title && !task.notes}
            <p class="leading-tight text-gray-400 dark:text-gray-500">
                （空のタスク）
            </p>
        {/if}
    </div>
    <div class="flex shrink-0 flex-col gap-1">
        <button
            onclick={() => onEdit(task)}
            class="cursor-pointer rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-600 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-300"
            data-testid="task-edit-btn"
            aria-label="タスクを編集">✏️</button
        >
        <button
            onclick={copyTask}
            class="cursor-pointer rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-600 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-300"
            data-testid="task-copy-btn"
            aria-label="タスクをコピー">📋</button
        >
        {#if notesClamped || notesExpanded}
            <button
                onclick={() => (notesExpanded = !notesExpanded)}
                class="cursor-pointer rounded p-1 text-xs text-gray-400 hover:bg-gray-100 hover:text-gray-500 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-400"
                aria-label={notesExpanded ? "notesを折りたたむ" : "notesを展開"}
                >{notesExpanded ? "▲" : "▼"}</button
            >
        {/if}
    </div>
    <!-- ドラッグハンドル + リモート更新マーク -->
    {#if onDragStart || isRemoteUpdated}
        <div class="flex flex-col items-center gap-1">
            {#if onDragStart}
                <span
                    class="mt-0.5 hidden cursor-grab text-gray-400 select-none sm:inline dark:text-gray-500"
                    draggable="true"
                    role="button"
                    tabindex="-1"
                    aria-label="ドラッグして並び替え"
                    ondragstart={(e) => {
                        e.dataTransfer!.effectAllowed = "move";
                        e.dataTransfer!.setData(
                            "application/x-task-id",
                            String(task.id),
                        );
                        onDragStart(task.id);
                    }}>⠿</span
                >
            {/if}
            {#if isRemoteUpdated}
                <span
                    class="inline-block size-2 rounded-full bg-blue-500 dark:bg-blue-400"
                    title="他の端末で更新されました"
                ></span>
            {/if}
        </div>
    {/if}
    {#if copyMessage}
        <div
            class="absolute top-1 right-2 rounded bg-gray-800 px-2 py-1 text-xs text-white shadow"
        >
            {copyMessage}
        </div>
    {/if}
</div>
