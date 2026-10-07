<script lang="ts">
    import { menuBehavior } from "#lib/actions/menu.ts";
    import {
        menuFrameClass,
        menuItemClass,
    } from "#lib/components/ui/styles.ts";
    import { clampDetector } from "#lib/actions/clamp.ts";
    import { taskTextColor } from "#lib/task-colors.ts";
    import NotesExpandButton from "./NotesExpandButton.svelte";
    /**
     * @fileoverview タスクアイテム（チェックボックス + テキスト表示 + 編集・コピーボタン）
     */

    import type { TaskStatus } from "#lib/schemas.ts";
    import type { TaskListItem } from "#lib/types.ts";
    import { nextTaskStatus } from "#lib/task-status.ts";
    import { linkify } from "#lib/client/search/linkify.ts";
    import { getTagColorClass } from "#lib/tag-palette.ts";
    import { downloadAttachment } from "#lib/client/attachments/attachment-download.ts";
    import { isImageAttachment } from "#lib/client/attachments/attachment-utils.ts";
    import { createTaskThumbnails } from "#lib/client/attachments/task-attachments.svelte.ts";
    import ImageLightbox from "#lib/components/dialogs/ImageLightbox.svelte";
    import { showErrorToast } from "#lib/client/ui/toast-store.svelte.ts";
    import { extractErrorMessage } from "#lib/client/ui/extract-error-message.ts";

    type Props = {
        task: TaskListItem;
        onToggle: (taskId: number, nextStatus: TaskStatus) => void;
        onEdit: (task: TaskListItem) => void;
        isDragging?: boolean;
        isRemoteUpdated?: boolean;
        isTempTask?: boolean;
        dropIndicator?: "before" | "after" | null;
        onDragStart?: (taskId: number, e: PointerEvent) => void;
    };

    let {
        task,
        onToggle,
        onEdit,
        isDragging = false,
        isRemoteUpdated = false,
        isTempTask = false,
        dropIndicator = null,
        onDragStart,
    }: Props = $props();

    let copyMessage = $state("");
    let copyMenuOpen = $state(false);
    let notesExpanded = $state(false);
    let notesClamped = $state(false);
    const isCompleted = $derived(task.status === "completed");
    const isRunning = $derived(task.status === "running");
    const titleColorClass = $derived(taskTextColor(task.status));
    const notesColorClass = $derived(taskTextColor(task.status, true));

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

    function handleToggle(event: Event) {
        const nextStatus = nextTaskStatus(task.status);
        const checkbox = event.currentTarget as HTMLInputElement;
        checkbox.checked = nextStatus === "completed";
        checkbox.indeterminate = nextStatus === "running";
        onToggle(task.id, nextStatus);
    }

    async function handleDownloadClick(attachmentId: number) {
        try {
            await downloadAttachment(attachmentId);
        } catch (error) {
            showErrorToast(extractErrorMessage(error));
        }
    }

    const thumbnails = createTaskThumbnails(() =>
        task.attachments.map((attachment) => attachment.id),
    );
</script>

<div
    class="relative flex items-start gap-3 border-b border-gray-200 px-3 py-3 hover:bg-gray-50 sm:px-5 dark:border-gray-700 dark:hover:bg-gray-700"
    class:opacity-50={task.status === "archived" || isDragging}
    class:border-t-2={dropIndicator === "before"}
    class:border-t-blue-500={dropIndicator === "before"}
    class:border-b-2={dropIndicator === "after"}
    class:border-b-blue-500={dropIndicator === "after"}
    data-testid="task-item"
    data-reorder-id={isTempTask ? undefined : task.id}
    role="listitem"
>
    <input
        type="checkbox"
        checked={isCompleted}
        indeterminate={isRunning}
        onclick={isTempTask ? (event) => event.preventDefault() : undefined}
        onchange={isTempTask ? undefined : handleToggle}
        class="mt-1 size-4 cursor-pointer disabled:cursor-not-allowed disabled:opacity-50"
        disabled={isTempTask}
    />
    <div
        class="min-w-0 flex-1 wrap-break-word break-all"
        class:line-through={isCompleted}
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
            <p class="leading-tight {titleColorClass}">
                <!-- eslint-disable-next-line svelte/no-at-html-tags -- linkify()が自前でHTMLエスケープ済み -->
                {@html linkify(task.title)}
            </p>
        {/if}
        {#if task.notes}
            <p
                use:clampDetector={(clamped) => (notesClamped = clamped)}
                class="mt-0.5 whitespace-pre-wrap {notesColorClass}"
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
                    {#if isImageAttachment(attachment.mimeType)}
                        {#await thumbnails.ensure(attachment.id) then imageUrl}
                            <button
                                type="button"
                                onclick={() => thumbnails.open(attachment.id)}
                                class="shrink-0 cursor-pointer rounded p-0.5"
                                data-testid="task-attachment-thumbnail"
                                title={attachment.filename}
                                aria-label={`${attachment.filename}を拡大表示`}
                            >
                                <img
                                    src={imageUrl}
                                    alt={attachment.filename}
                                    class="h-8 w-8 rounded object-cover"
                                />
                            </button>
                        {:catch}
                            <span
                                class="text-xs text-gray-400"
                                title={attachment.filename}
                                aria-label={`${attachment.filename}の画像取得に失敗`}
                                >⚠️</span
                            >
                        {/await}
                    {:else}
                        <button
                            type="button"
                            onclick={() => handleDownloadClick(attachment.id)}
                            class="cursor-pointer rounded p-0.5 text-xs hover:bg-gray-100 dark:hover:bg-gray-700"
                            data-testid="task-attachment-icon"
                            title={attachment.filename}
                            aria-label={`${attachment.filename}をダウンロード`}
                            >📎</button
                        >
                    {/if}
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
            onclick={isTempTask ? undefined : () => onEdit(task)}
            class="cursor-pointer rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-600 disabled:cursor-not-allowed disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-300"
            data-testid="task-edit-btn"
            aria-label="タスクを編集"
            disabled={isTempTask}
            title="編集">✏️</button
        >
        <div
            class="relative"
            use:menuBehavior={{
                open: copyMenuOpen,
                onClose: () => (copyMenuOpen = false),
            }}
        >
            <button
                onclick={() => (copyMenuOpen = !copyMenuOpen)}
                class="cursor-pointer rounded p-1 text-gray-500 hover:bg-gray-100 hover:text-gray-600 dark:text-gray-400 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                data-testid="task-copy-btn"
                aria-label="タスクをコピー"
                title="コピー">📋</button
            >
            {#if copyMenuOpen}
                <div
                    class={menuFrameClass}
                    data-menu-frame
                    role="menu"
                    data-testid="task-copy-menu"
                >
                    <button
                        class={menuItemClass}
                        onclick={copyAll}
                        disabled={!task.title && !task.notes}
                        data-testid="task-copy-all"
                        role="menuitem"
                    >
                        全体をコピー
                    </button>
                    <button
                        class={menuItemClass}
                        onclick={copyTitle}
                        disabled={!task.title}
                        data-testid="task-copy-title"
                        role="menuitem"
                    >
                        タイトルのみ
                    </button>
                    <button
                        class={menuItemClass}
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
            <NotesExpandButton
                expanded={notesExpanded}
                onclick={() => (notesExpanded = !notesExpanded)}
            />
        {/if}
    </div>
    <!-- ドラッグハンドル + リモート更新マーク -->
    {#if onDragStart || isRemoteUpdated}
        <div class="flex flex-col items-center gap-1">
            {#if onDragStart}
                <span
                    class="mt-0.5 touch-none text-gray-400 select-none dark:text-gray-500"
                    class:cursor-grab={!isTempTask}
                    class:cursor-grabbing={!isTempTask && isDragging}
                    class:cursor-not-allowed={isTempTask}
                    role="button"
                    tabindex="-1"
                    aria-label="ドラッグして並び替え"
                    data-testid="task-drag-handle"
                    aria-disabled={isTempTask ? "true" : undefined}
                    title="ドラッグして並び替え"
                    onpointerdown={isTempTask
                        ? undefined
                        : (e) => onDragStart(task.id, e)}>⠿</span
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

{#if thumbnails.lightboxImageUrl}
    <ImageLightbox
        imageUrl={thumbnails.lightboxImageUrl}
        onClose={() => thumbnails.close()}
    />
{/if}
