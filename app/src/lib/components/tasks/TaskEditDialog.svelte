<script lang="ts">
    /**
     * @fileoverview タスク編集ダイアログ（内容編集・タグ設定・リスト移動・完了状態変更）
     */

    import type { TagInfo } from "$lib/types";
    import TagEditor from "./TagEditor.svelte";

    type Props = {
        open: boolean;
        text: string;
        moveTo: string;
        keepOrder: boolean;
        completed: boolean;
        tags: TagInfo[];
        listTagCandidates: TagInfo[];
        lists: Array<{ id: number; title: string }>;
        onSubmit: (data: {
            text: string;
            moveTo: string;
            keepOrder: boolean;
            completed: boolean;
            tags: TagInfo[];
        }) => void;
        onClose: () => void;
    };

    let {
        open,
        text,
        moveTo,
        keepOrder,
        completed,
        tags,
        listTagCandidates,
        lists,
        onSubmit,
        onClose,
    }: Props = $props();

    let localText = $state("");
    let localMoveTo = $state("");
    let localKeepOrder = $state(false);
    let localCompleted = $state(false);
    let localTags = $state<TagInfo[]>([]);
    let textareaEl = $state<HTMLTextAreaElement | null>(null);
    let closeButtonEl = $state<HTMLButtonElement | null>(null);

    // ダイアログが開くたびにローカル状態をリセット（同じタスクの再編集にも対応）
    $effect(() => {
        if (open) {
            localText = text;
            localMoveTo = moveTo;
            localKeepOrder = keepOrder;
            localCompleted = completed;
            localTags = [...tags];
            // tick 後にフォーカス
            queueMicrotask(() => textareaEl?.focus());
        }
    });

    function handleSubmit() {
        onSubmit({
            text: localText,
            moveTo: localMoveTo,
            keepOrder: localKeepOrder,
            completed: localCompleted,
            tags: localTags,
        });
    }
</script>

{#if open}
    <div
        class="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 sm:p-0"
        role="dialog"
        aria-modal="true"
    >
        <div
            class="w-full max-w-2xl rounded-lg bg-white shadow-xl dark:bg-gray-800"
        >
            <div class="flex items-center justify-between px-6 py-4">
                <h2
                    class="text-lg font-semibold text-gray-800 dark:text-gray-100"
                >
                    タスクの編集
                </h2>
                <button
                    bind:this={closeButtonEl}
                    onclick={onClose}
                    class="cursor-pointer rounded p-1 text-gray-400 hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700 dark:hover:text-gray-300"
                    aria-label="閉じる"
                    title="閉じる"
                >
                    ✕
                </button>
            </div>
            <div class="p-6">
                <div class="mb-4 flex items-center gap-2">
                    <input
                        id="edit-completed"
                        type="checkbox"
                        bind:checked={localCompleted}
                        class="cursor-pointer"
                    />
                    <label
                        for="edit-completed"
                        class="cursor-pointer text-gray-700 dark:text-gray-200"
                        >完了</label
                    >
                </div>
                <div class="mb-4">
                    <label
                        class="mb-1 block cursor-pointer font-medium text-gray-700 dark:text-gray-200"
                        for="edit-text">内容</label
                    >
                    <textarea
                        id="edit-text"
                        rows={10}
                        bind:value={localText}
                        bind:this={textareaEl}
                        onkeydown={(e) => {
                            if (e.key === "Escape") {
                                e.preventDefault();
                                closeButtonEl?.focus();
                            }
                        }}
                        class="w-full rounded border border-gray-200 px-3 py-2 wrap-break-word break-all focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                    ></textarea>
                </div>
                <div class="mb-4">
                    <span
                        class="mb-1 block font-medium text-gray-700 dark:text-gray-200"
                        >タグ</span
                    >
                    <TagEditor
                        bind:tags={localTags}
                        candidates={listTagCandidates}
                    />
                </div>
                <div class="mb-4">
                    <label
                        class="mb-1 block cursor-pointer font-medium text-gray-700 dark:text-gray-200"
                        for="edit-move-to">リスト</label
                    >
                    <select
                        id="edit-move-to"
                        bind:value={localMoveTo}
                        class="w-full rounded border border-gray-200 px-3 py-2 wrap-break-word break-all focus:border-blue-500 focus:outline-none dark:border-gray-600 dark:bg-gray-700 dark:text-gray-100"
                    >
                        {#each lists as l (l.id)}
                            <option value={String(l.id)}>{l.title}</option>
                        {/each}
                    </select>
                </div>
                <div class="mb-6 flex items-center gap-2">
                    <input
                        id="edit-keep-order"
                        type="checkbox"
                        bind:checked={localKeepOrder}
                        class="cursor-pointer"
                    />
                    <label
                        for="edit-keep-order"
                        class="cursor-pointer text-gray-700 dark:text-gray-200"
                        >並び順を維持する</label
                    >
                </div>
                <div class="flex justify-end">
                    <button
                        onclick={handleSubmit}
                        class="cursor-pointer rounded bg-blue-600 px-6 py-2 text-white hover:bg-blue-700 focus:outline-none"
                        >保存</button
                    >
                </div>
            </div>
        </div>
    </div>
{/if}
