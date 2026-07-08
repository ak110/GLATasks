<script lang="ts">
    /**
     * @fileoverview タスクアイテム（チェックボックス + テキスト表示 + 編集・コピーボタン）
     */

    import type { TaskListItem } from "$lib/types";
    import { linkify } from "$lib/linkify";
    import { getTagColorClass } from "$lib/tag-palette";
    import { downloadAttachment } from "$lib/attachment-download";
    import { showErrorToast } from "$lib/toast-store.svelte";
    import { extractErrorMessage } from "$lib/extract-error-message";

    type Props = {
        task: TaskListItem;
        onToggle: (taskId: number, checked: boolean) => void;
        onEdit: (task: TaskListItem) => void;
        isDragging?: boolean;
        isRemoteUpdated?: boolean;
        dropIndicator?: "before" | "after" | null;
        onDragStart?: (taskId: number, e: PointerEvent) => void;
    };

    let {
        task,
        onToggle,
        onEdit,
        isDragging = false,
        isRemoteUpdated = false,
        dropIndicator = null,
        onDragStart,
    }: Props = $props();

    let copyMessage = $state("");
    let copyMenuOpen = $state(false);
    let notesExpanded = $state(false);
    let notesClamped = $state(false);
    let notesEl: HTMLParagraphElement | undefined = $state();
    let copyMenuEl: HTMLDivElement | undefined = $state();

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

    // コピーメニュー外クリック/Escapeで閉じる
    $effect(() => {
        if (!copyMenuOpen) return;
        const onClick = (e: MouseEvent) => {
            if (!copyMenuEl?.contains(e.target as Node)) {
                copyMenuOpen = false;
            }
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") copyMenuOpen = false;
        };
        document.addEventListener("mousedown", onClick);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("mousedown", onClick);
            document.removeEventListener("keydown", onKey);
        };
    });

    async function copyText(value: string) {
        await navigator.clipboard.writeText(value);
        copyMessage = "コピーしました";
        setTimeout(() => (copyMessage = ""), 2000);
        copyMenuOpen = false;
    }

    function copyAll() {
        copyText(task.notes ? `${task.title}\n\n${task.notes}` : task.title);
    }
    function copyTitle() {
        copyText(task.title);
    }
    function copyNotes() {
        copyText(task.notes);
    }

    async function handleDownloadClick(attachmentId: number) {
        try {
            await downloadAttachment(attachmentId);
        } catch (error) {
            showErrorToast(extractErrorMessage(error));
        }
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
    data-reorder-id={task.id}
    role="listitem"
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
        {#if task.kind === "todo"}
            <span
                class="mb-0.5 inline-flex items-center rounded bg-red-100 px-1.5 py-0.5 text-[11px] leading-tight text-red-700 dark:bg-red-900/40 dark:text-red-400"
                data-testid="task-kind-todo"
            >
                TODO
            </span>
        {/if}
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
        {#if task.attachments.length > 0 || task.tags.length > 0}
            <div class="mt-1 flex flex-wrap items-center gap-1">
                {#each task.attachments as attachment (attachment.id)}
                    <button
                        onclick={() => handleDownloadClick(attachment.id)}
                        class="cursor-pointer rounded p-0.5 text-xs hover:bg-gray-100 dark:hover:bg-gray-700"
                        data-testid="task-attachment-icon"
                        title={attachment.filename}
                        aria-label={`${attachment.filename}をダウンロード`}
                        >📎</button
                    >
                {/each}
                {#if task.tags.length > 0}
                    <div class="flex flex-wrap gap-1" data-testid="task-tags">
                        {#each task.tags as tag (tag.name)}
                            <span
                                class="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] leading-tight {getTagColorClass(
                                    tag.color,
                                )}"
                            >
                                {tag.name}
                            </span>
                        {/each}
                    </div>
                {/if}
            </div>
        {/if}
    </div>
    <div class="flex shrink-0 flex-col gap-1">
        <button
            onclick={() => onEdit(task)}
            class="cursor-pointer rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-600 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-300"
            data-testid="task-edit-btn"
            aria-label="タスクを編集"
            title="編集">✏️</button
        >
        <div class="relative" bind:this={copyMenuEl}>
            <button
                onclick={() => (copyMenuOpen = !copyMenuOpen)}
                class="cursor-pointer rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-600 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                data-testid="task-copy-btn"
                aria-label="タスクをコピー"
                aria-haspopup="menu"
                aria-expanded={copyMenuOpen}
                title="コピー">📋</button
            >
            {#if copyMenuOpen}
                <div
                    class="absolute top-full right-0 z-20 min-w-max rounded border border-gray-200 bg-white py-1 shadow-lg dark:border-gray-600 dark:bg-gray-800"
                    role="menu"
                    data-testid="task-copy-menu"
                >
                    <button
                        class="block w-full cursor-pointer px-4 py-1.5 text-left hover:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-400 dark:text-gray-100 dark:hover:bg-gray-700 dark:disabled:text-gray-500"
                        onclick={copyAll}
                        disabled={!task.title && !task.notes}
                        data-testid="task-copy-all"
                        role="menuitem"
                    >
                        全体をコピー
                    </button>
                    <button
                        class="block w-full cursor-pointer px-4 py-1.5 text-left hover:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-400 dark:text-gray-100 dark:hover:bg-gray-700 dark:disabled:text-gray-500"
                        onclick={copyTitle}
                        disabled={!task.title}
                        data-testid="task-copy-title"
                        role="menuitem"
                    >
                        タイトルのみ
                    </button>
                    <button
                        class="block w-full cursor-pointer px-4 py-1.5 text-left hover:bg-gray-100 disabled:cursor-not-allowed disabled:text-gray-400 dark:text-gray-100 dark:hover:bg-gray-700 dark:disabled:text-gray-500"
                        onclick={copyNotes}
                        disabled={!task.notes}
                        data-testid="task-copy-notes"
                        role="menuitem"
                    >
                        内容のみ
                    </button>
                </div>
            {/if}
        </div>
        {#if notesClamped || notesExpanded}
            <button
                onclick={() => (notesExpanded = !notesExpanded)}
                class="cursor-pointer rounded p-1 text-xs text-gray-400 hover:bg-gray-100 hover:text-gray-500 dark:text-gray-500 dark:hover:bg-gray-700 dark:hover:text-gray-400"
                aria-label={notesExpanded ? "notesを折りたたむ" : "notesを展開"}
                title={notesExpanded ? "折りたたむ" : "展開"}
                >{notesExpanded ? "▲" : "▼"}</button
            >
        {/if}
    </div>
    <!-- ドラッグハンドル + リモート更新マーク -->
    {#if onDragStart || isRemoteUpdated}
        <div class="flex flex-col items-center gap-1">
            {#if onDragStart}
                <span
                    class="mt-0.5 cursor-grab touch-none text-gray-400 select-none dark:text-gray-500"
                    class:cursor-grabbing={isDragging}
                    role="button"
                    tabindex="-1"
                    aria-label="ドラッグして並び替え"
                    data-testid="task-drag-handle"
                    title="ドラッグして並び替え"
                    onpointerdown={(e) => onDragStart(task.id, e)}>⠿</span
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
